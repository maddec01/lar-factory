// Every item source the onboarded repositories' configs name, as the one item source the board server reads and writes through.
// GitHub repository issues read through gh, and an Azure DevOps team's backlog and current sprint through az.

import { decodePart, itemSource, refKey, shownRepo, type Item, type ItemSourceKind, type RepoConfig } from '@lar-factory/shared';
import type { RepositoryConfig } from '../config/repository-config.ts';
import type { OnboardedConfigs } from '../config/repository-settings.ts';
import { repoIssues } from '../github/repo-issues.ts';
import { azureBoard } from '../azure/azure-board.ts';
import { az, type Az } from '../azure/azure-items.ts';
import { ReadProblem, type ItemSource, type ItemsRead, type ReadPace, type ReadProgress } from './item-source.ts';

/** Who writes for a repository no source names, when its repository is not onboarded. */
const NOT_ONBOARDED = "That item's repository isn't onboarded.";
const unlisted: ItemSource = {
  read: async () => ({ title: '', items: [] }),
  setStatus: async () => NOT_ONBOARDED,
  statusRefusal: () => NOT_ONBOARDED,
  addLabel: async () => NOT_ONBOARDED,
  searchTickets: async () => { throw new Error(NOT_ONBOARDED); },
  readTicket: async () => { throw new Error(NOT_ONBOARDED); },
  observeTicket: async () => { throw new Error(NOT_ONBOARDED); },
  setParentStatus: async () => NOT_ONBOARDED,
  abandon: async () => NOT_ONBOARDED,
};

/** A repository's config as the page sees it: its role, item source, show setting and custom labels. */
export function repoView({ repo, role, itemSource, show, labels }: RepositoryConfig): RepoConfig {
  if (itemSource.kind === 'issues') return { repo, role, items: 'issues', show, labels };
  return { repo, role, items: 'azure-board', team: itemSource.team, show, labels };
}

/**
 * Each repository's item source as its config names it, merged, showing each repository's items as its show setting
 * says. Repositories reading the same Azure DevOps team's board share one adapter, which then sorts the team's work items among them by their repo- tags.
 * Each source waits while the pace says its kind waits. `run` stands in for az in tests.
 */
export function configuredSources(configs: readonly RepositoryConfig[], run: Az = az): MergedSource {
  // Azure DevOps names ignore case.
  const teamKey = (repo: string, kind: string, team: string) => [kind, ...repo.split('/').slice(0, 2).map(decodePart), team].join('/').toLowerCase();
  const teams = new Map<string, string[]>();
  for (const { repo, itemSource } of configs) {
    if (itemSource.kind !== 'azure-board') continue;
    const key = teamKey(repo, itemSource.kind, itemSource.team);
    teams.set(key, [...teams.get(key) ?? [], repo]);
  }
  const azure = new Map<string, ItemSource>();
  const teamSource = (repo: string, kind: 'azure-board', team: string) => {
    const key = teamKey(repo, kind, team);
    if (!azure.has(key)) azure.set(key, azureBoard(teams.get(key)!, team, run));
    return azure.get(key)!;
  };
  const byRepo = new Map(configs.map(({ repo, itemSource }): [string, ItemSource] => {
    if (itemSource.kind === 'issues') return [repo, repoIssues(repo)];
    return [repo, teamSource(repo, itemSource.kind, itemSource.team)];
  }));
  const kinds = new Map(configs.map((config): [ItemSource, ItemSourceKind] => [byRepo.get(config.repo)!, itemSource(repoView(config))]));
  const optedIn = configs.filter((c) => c.show === 'opted-in').map((c) => c.repo);
  return mergeSources(byRepo, optedIn, kinds);
}

/** How often a source holding active work reads, and how often an idle one does: its safety read for edits made elsewhere. */
export const ACTIVE_READ_MS = 15_000;
const IDLE_READ_MS = 5 * 60_000;
/** How often each source checks for changes made elsewhere, as on github.com: a check that finds none costs no quota. */
const PROBE_MS = 5_000;
/** How long a source waits after a failed change check, which costs quota, unlike a 304. */
const PROBE_RETRY_MS = 60_000;
/** The shortest gap between two reads of one source, however often status.sh or the board asks for one. */
const MIN_GAP_MS = 2_000;
/** The shortest gap at the pace. */
const minGap = (pace: ReadPace) => Math.min(MIN_GAP_MS, pace.activeMs ?? ACTIVE_READ_MS);

/** A merged item source that reads each source at its own pace. */
export interface MergedSource extends ItemSource {
  /**
   * Runs the change check of each source due one at `pace`, unless `slow` holds, and makes each changed item it lists
   * due on the next read, or the whole source when the check can't tell or names an item the source doesn't list.
   */
  probe(pace: ReadPace): Promise<void>;
  /** Whether a read at `pace` would read any source. */
  due(pace: ReadPace): boolean;
  /**
   * Makes the item at `url`, or the item that lists it as a slice or linked PR, due on the next read; when none does,
   * the whole source of the GitHub repository it names, else every source, as when `url` is undefined.
   */
  invalidate(url?: string): void;
  /** Whether the last read read the item's source afresh, rather than listing it from an earlier read. */
  readAfresh(item: Item): boolean;
}

/** Whether the item, one of its slices or one of its linked PRs is at `url`, ignoring case, as GitHub's owner names do. */
const listsUrl = (item: Item, url: string) =>
  [item.url, ...item.slices.map((s) => s.url), ...item.linkedPrs.map((pr) => pr.url)].some((at) => at?.toLowerCase() === url.toLowerCase());
/** The repository, lowercased, and number a GitHub issue or PR URL names; undefined for any other URL. */
function githubRef(url: string): { repo: string; number: number } | undefined {
  const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/i.exec(url);
  return match ? { repo: match[1]!.toLowerCase(), number: Number(match[2]) } : undefined;
}

/**
 * Merges the repositories' sources, keeping the first copy of each item. Writes go to the source that listed the
 * item, or to its repository's source. An unknown repository refuses writes. Failed reads preserve previous data;
 * a ReadProblem leaves out only its source's items and names the problem for each repository it serves.
 * Opted-in repositories show only items carrying a status. A paced read refreshes due sources and keeps the rest
 * from their last good read, reporting progress as each source lands.
 */
export function mergeSources(byRepo: ReadonlyMap<string, ItemSource>, optedIn: readonly string[] = [],
  kinds: ReadonlyMap<ItemSource, ItemSourceKind> = new Map()): MergedSource {
  const sourceByRepo = new Map([...byRepo].map(([repo, source]) => [repo.toLowerCase(), source]));
  const optIn = new Set(optedIn.map((repo) => repo.toLowerCase()));
  const optedOut = (repo: string | null) => optIn.has(repo?.toLowerCase() ?? '');
  /** The item as a read shows it, or null when it's left out. */
  const shown = (item: Item): Item | null => {
    if (item.statuses.length > 0) return item;
    if (!item.untaggedFor) return optedOut(item.repo) ? null : item;
    const kept = item.untaggedFor.filter((repo) => !optedOut(repo));
    if (kept.length === item.untaggedFor.length) return item;
    return kept.length ? { ...item, repo: kept[0]!, untaggedFor: kept } : null;
  };
  const sources = [...new Set([...byRepo.values()])];
  const named = new Map<ItemSource, string[]>();
  for (const [repo, source] of byRepo) named.set(source, [...named.get(source) ?? [], repo]);
  /** How a read names the source: its own name, else the repositories it stands for, else a generic source name. */
  const nameOf = (source: ItemSource) => source.name ?? named.get(source)?.map((repo) => shownRepo(repo).split('/').at(-1)).join(', ') ?? 'an item source';
  const readOf = async (source: ItemSource, progress?: ReadProgress): Promise<ItemsRead> => {
    const name = nameOf(source);
    progress?.started(name);
    try {
      return await readNamed(source);
    } finally {
      progress?.finished(name);
    }
  };
  const readNamed = (source: ItemSource): Promise<ItemsRead> => {
    const repos = named.get(source);
    return repos === undefined ? source.read() : source.read().catch((err: unknown) => {
      if (err instanceof ReadProblem) return { title: '', items: [], problems: repos.map((repo) => ({ repo, problem: err.message, ...err.fix !== undefined && { fix: err.fix } })) };
      throw new Error(`${repos.join(', ')}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    });
  };
  /** Each source's last good read, when its last whole read and its last read of any kind started, good or not. */
  const lastRead = new Map<ItemSource, ItemsRead>();
  const wholeAt = new Map<ItemSource, number>();
  const startedAt = new Map<ItemSource, number>();
  /** The sources asked to read whole, and the items asked for by Item.id, since their last read started. */
  const askedWhole = new Set<ItemSource>();
  const askedItems = new Set<string>();
  /** The sources whose last read failed: one that read before retries at the active pace, and one that never did isn't waiting. */
  const failed = new Set<ItemSource>();
  /** The sources the last read read whole, and the items it read alone. */
  let afresh = new Set<ItemSource>();
  let afreshItems = new Set<string>();
  /** Whether the pace holds the source back, by its kind. */
  const waits = (source: ItemSource, pace: ReadPace) => {
    const kind = kinds.get(source);
    return kind !== undefined && pace.waits?.(kind) === true;
  };
  /**
   * What a read at `pace` reads of the source: all of it before its first good read, when asked to, and every idle
   * interval; else its active and asked-for items alone, through readSome, or all of it when it has none; else nothing.
   */
  const planOf = (source: ItemSource, pace: ReadPace): 'whole' | Item[] | null => {
    if (waits(source, pace)) return null;
    const started = startedAt.get(source);
    if (started === undefined) return 'whole';
    const since = pace.now - started;
    const activeMs = pace.activeMs ?? ACTIVE_READ_MS;
    // A source that never read retries at the active pace, not on every tick.
    if (!lastRead.has(source)) return since >= activeMs ? 'whole' : null;
    if (askedWhole.has(source) && since >= (failed.has(source) ? activeMs : minGap(pace))) return 'whole';
    if (pace.now - wholeAt.get(source)! >= (pace.idleMs ?? IDLE_READ_MS)) return 'whole';
    const listed = lastRead.get(source)!.items;
    const asked = listed.filter((item) => askedItems.has(item.id));
    const active = pace.slow ? [] : listed.filter(source.seesEdits ? pace.polled : pace.active);
    if (!(asked.length && since >= minGap(pace)) && !(active.length && since >= activeMs)) return null;
    return source.readSome ? [...new Set([...asked, ...active])] : 'whole';
  };
  /** Reads the plan's items alone, keeping the rest of the source's last read; a failed read of a few reads it all. */
  const readPlanned = async (source: ItemSource, plan: 'whole' | Item[], progress?: ReadProgress): Promise<ItemsRead> => {
    if (plan === 'whole') return readOf(source, progress);
    const last = lastRead.get(source)!;
    let fresh: Item[];
    try { fresh = await source.readSome!(plan); }
    catch { return readOf(source, progress); }
    const byId = new Map(fresh.map((item) => [item.id, item]));
    // A planned item the provider no longer lists, as when it was deleted, leaves. A read can bring more than it was
    // asked for, as an Azure item's Tasks, new ones too, so every item it brings replaces or joins the last read. A
    // dossier read alone can't tell its sub-issues are on the board, so it keeps its map from the whole read.
    const planned = new Set(plan.map((item) => item.id));
    const kept = last.items.flatMap((item) => {
      const fresh = byId.get(item.id);
      if (!fresh) return planned.has(item.id) ? [] : [item];
      byId.delete(item.id);
      return [fresh.map === undefined && item.map ? { ...fresh, map: item.map } : fresh];
    });
    return { ...last, items: [...kept, ...byId.values()] };
  };
  /** When each source's last good change check started, and when one that failed may check again. */
  const probedAt = new Map<ItemSource, number>();
  const probeAfter = new Map<ItemSource, number>();
  /**
   * The items, of any source, at `url` or listing it as a slice or linked PR, and those it blocks: a blocker closing
   * changes what they show, and Start after, but moves none of their updated_at.
   */
  const listing = (url: string) => {
    const all = sources.flatMap((source) => lastRead.get(source)?.items ?? []);
    const found = all.filter((item) => listsUrl(item, url));
    const ref = githubRef(url);
    const keys = new Set([...found.map((item) => refKey(item.repo, item.number)), ...ref ? [refKey(ref.repo, ref.number)] : []].map((key) => key.toLowerCase()));
    return [...found, ...all.filter((item) => !found.includes(item) && item.blockers.some((b) => keys.has(refKey(b.repo, b.number).toLowerCase())))];
  };
  /**
   * Asks for the items the changed URLs name, wherever they're listed, as a slice in another repository's source; a
   * URL none lists, as a new issue or a PR that just linked one, which moves no issue's updated_at, reads its source whole.
   */
  const ask = (source: ItemSource, changed: string[] | null) => {
    if (changed === null) return void askedWhole.add(source);
    for (const url of changed) {
      const found = listing(url);
      for (const item of found) askedItems.add(item.id);
      if (!found.length) askedWhole.add(source);
    }
  };
  /** The source that listed each item, by Item.id, in the last read. */
  let listedBy = new Map<string, ItemSource>();
  const forRepo = (repo: string | null) => (repo && sourceByRepo.get(repo.toLowerCase())) || unlisted;
  const sourceOf = (item: Item) => listedBy.get(item.id) ?? forRepo(item.repo);
  /**
   * Every source's last good read merged, with the source that listed each item, by Item.id, and the repositories
   * waiting for their source's first read: not one whose read failed or that the pace says its tool blocks.
   */
  const merged = (pace?: ReadPace) => {
    const reads = sources.map((source) => lastRead.get(source) ?? { title: '', items: [] });
    const listed = new Map<string, ItemSource>();
    const items = reads.flatMap((read, index) => read.items.filter((item) => {
      if (listed.has(item.id)) return false;
      listed.set(item.id, sources[index]!);
      return true;
    }));
    const problems = reads.flatMap((read) => read.problems ?? []);
    const blocked = (source: ItemSource) => {
      const kind = kinds.get(source);
      return kind !== undefined && pace?.blocked?.(kind) === true;
    };
    const waiting = [...byRepo].filter(([, source]) => !lastRead.has(source) && !failed.has(source) && !blocked(source)).map(([repo]) => repo);
    const read: ItemsRead = { title: reads[0]?.title ?? '', items: items.flatMap((item) => shown(item) ?? []), ...problems.length > 0 && { problems },
      ...waiting.length > 0 && { waiting } };
    return { read, listed };
  };
  return {
    async read(progress, pace) {
      const plans = sources.flatMap((source) => {
        const plan = pace ? planOf(source, pace) : 'whole';
        return plan ? [{ source, plan }] : [];
      });
      const now = pace?.now ?? Date.now();
      for (const { source, plan } of plans) {
        startedAt.set(source, now);
        if (plan === 'whole') {
          wholeAt.set(source, now);
          askedWhole.delete(source);
          for (const item of lastRead.get(source)?.items ?? []) askedItems.delete(item.id);
        } else for (const item of plan) askedItems.delete(item.id);
      }
      // A source that read keeps its read though another failed, so the next read needn't read it again. Each read
      // that lands while another still reads shows what has landed so far.
      let reading = plans.length;
      const settled = await Promise.allSettled(plans.map(async ({ source, plan }) => {
        try {
          const read = await readPlanned(source, plan, progress).catch((err: unknown) => {
            failed.add(source);
            throw err;
          });
          lastRead.set(source, read);
          failed.delete(source);
          if (reading > 1) progress?.landed?.(merged(pace).read);
        } finally {
          reading--;
        }
      }));
      // A failed read asks again for what it read, so a change a check found isn't lost to a passing error.
      settled.forEach((read, index) => {
        const { source } = plans[index]!;
        if (read.status === 'rejected' && lastRead.has(source)) askedWhole.add(source);
      });
      const rejected = settled.find((read) => read.status === 'rejected');
      if (rejected) throw rejected.reason;
      afresh = new Set(plans.filter(({ plan }) => plan === 'whole').map(({ source }) => source));
      afreshItems = new Set(plans.flatMap(({ plan }) => (plan === 'whole' ? [] : plan.map((item) => item.id))));
      const { read, listed } = merged(pace);
      listedBy = listed;
      return read;
    },
    async probe(pace) {
      if (pace.slow) return;
      // A check looks back to the last good one, or to the source's first read; a failed check leaves that in place.
      await Promise.allSettled(sources.map(async (source) => {
        const since = probedAt.get(source) ?? wholeAt.get(source);
        if (!source.changes || !lastRead.has(source) || since === undefined || waits(source, pace) || pace.now < (probeAfter.get(source) ?? since + PROBE_MS)) return;
        probeAfter.set(source, pace.now + PROBE_RETRY_MS);
        ask(source, await source.changes(since));
        probedAt.set(source, pace.now);
        probeAfter.delete(source);
      }));
    },
    due: (pace) => sources.some((source) => planOf(source, pace) !== null),
    invalidate(url) {
      const found = url === undefined ? [] : listing(url);
      for (const item of found) askedItems.add(item.id);
      if (found.length) return;
      // A GitHub URL outside the onboarded repositories cannot affect any source.
      const ref = url === undefined ? undefined : githubRef(url);
      const own = ref && sourceByRepo.get(ref.repo);
      for (const source of own ? [own] : ref ? [] : sources) askedWhole.add(source);
    },
    readAfresh: (item) => afresh.has(sourceOf(item)) || afreshItems.has(item.id),
    setStatus: (item, status) => sourceOf(item).setStatus(item, status),
    statusRefusal: (item) => ('id' in item ? sourceOf(item) : forRepo(item.repo)).statusRefusal(item),
    addLabel: (item, label) => sourceOf(item).addLabel(item, label),
    searchTickets: (repo, query) => forRepo(repo).searchTickets(repo, query),
    readTicket: (repo, number) => forRepo(repo).readTicket(repo, number),
    observeTicket: (repo, number) => forRepo(repo).observeTicket(repo, number),
    setParentStatus: (parent, status) => forRepo(parent.repo).setParentStatus(parent, status),
    abandon: (item) => sourceOf(item).abandon(item),
  };
}

/** The onboarded repositories' item source, with the repositories it last read. */
export interface OnboardedSources extends MergedSource {
  /** The repositories as the last read found them, none before it. */
  repos(): RepoConfig[];
  /** Makes the next read load the configs again, and read every source. */
  reload(): void;
}

/**
 * The item source the onboarded repositories name as `load` reads their configs: a read loads them first when it has
 * no pace, before the first read, when reload asked for it or once the pace's idle time has passed since they loaded, and builds the merged source
 * again when they changed, so a config merged to a default branch shows within an idle read. A read leaves out the
 * items of each repository whose config `load` couldn't read, which a shared Azure source may still list, and
 * so does each read so far it reports as landed. A write goes through the source the last read built.
 */
export function onboardedSources(load: () => Promise<Omit<OnboardedConfigs, 'setups'>>, build = configuredSources): OnboardedSources {
  let configs: RepositoryConfig[] = [];
  let current = build(configs);
  let key = JSON.stringify(configs);
  let leftOff = new Set<string>();
  let loadedAt: number | null = null;
  let reloadAsked = false;
  const loadDue = (pace?: ReadPace) => !pace || loadedAt === null
    || pace.now - loadedAt >= (reloadAsked ? minGap(pace) : pace.idleMs ?? IDLE_READ_MS);
  return {
    async read(progress, pace) {
      if (loadDue(pace)) {
        loadedAt = pace?.now ?? Date.now();
        reloadAsked = false;
        const loaded = await load();
        configs = loaded.configs;
        if (JSON.stringify(configs) !== key) {
          current = build(configs);
          key = JSON.stringify(configs);
        }
        leftOff = new Set(loaded.problems.map((p) => p.repo.toLowerCase()));
      }
      const shown = (read: ItemsRead) => ({ ...read, items: read.items.filter((item) => !leftOff.has(item.repo?.toLowerCase() ?? '')) });
      const landed = progress?.landed;
      return shown(await current.read(landed ? { ...progress!, landed: (read) => landed(shown(read)) } : progress, pace));
    },
    probe: (pace) => current.probe(pace),
    due: (pace) => loadDue(pace) || current.due(pace),
    invalidate: (url) => current.invalidate(url),
    readAfresh: (item) => current.readAfresh(item),
    reload() {
      reloadAsked = true;
      current.invalidate();
    },
    repos: () => configs.map(repoView),
    setStatus: (item, status) => current.setStatus(item, status),
    statusRefusal: (item) => current.statusRefusal(item),
    addLabel: (item, label) => current.addLabel(item, label),
    searchTickets: (repo, query) => current.searchTickets(repo, query),
    readTicket: (repo, number) => current.readTicket(repo, number),
    observeTicket: (repo, number) => current.observeTicket(repo, number),
    setParentStatus: (parent, status) => current.setParentStatus(parent, status),
    abandon: (item) => current.abandon(item),
  };
}
