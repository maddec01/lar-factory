// Every item source the onboarded repositories' configs name, as the one item source the board server reads and writes through.
// A GitHub Project or a repository's issues read through gh, and an Azure DevOps team's sprint or backlog through az.

import type { Item, RepoConfig } from '@lar-factory/shared';
import type { OnboardedConfigs, RepositoryConfig } from '../config/repository-config.ts';
import { githubProject } from '../github/github-project.ts';
import { repoIssues } from '../github/repo-issues.ts';
import { azureBacklog } from '../azure/azure-backlog.ts';
import { az, decoded, type Az } from '../azure/azure-items.ts';
import { azureSprint } from '../azure/azure-sprint.ts';
import { ReadProblem, type ItemSource, type ItemsRead } from './item-source.ts';

/** Who writes for a repository no source names, on a board that reads no Project. */
const NOT_ONBOARDED = "That item's repository isn't onboarded.";
const unlisted: ItemSource = {
  read: async () => ({ title: '', items: [] }),
  setStatus: async () => NOT_ONBOARDED,
  statusRefusal: () => NOT_ONBOARDED,
  addLabel: async () => NOT_ONBOARDED,
  create: async () => ({ item: null, issueUrl: null, error: NOT_ONBOARDED }),
  setParentStatus: async () => NOT_ONBOARDED,
  abandon: async () => NOT_ONBOARDED,
};

/** A repository's config as the page sees it: its role, item source, show setting and custom labels. */
export function repoView({ repo, role, itemSource, show, labels }: RepositoryConfig): RepoConfig {
  if (itemSource.kind === 'issues') return { repo, role, items: 'issues', show, labels };
  if (itemSource.kind === 'azure-sprint') return { repo, role, items: 'sprint', team: itemSource.team, show, labels };
  if (itemSource.kind === 'azure-backlog') return { repo, role, items: 'backlog', team: itemSource.team, show, labels };
  return { repo, role, items: 'project', project: { owner: itemSource.owner, number: itemSource.number }, show, labels };
}

/**
 * Each repository's item source as its config names it, merged, showing each repository's items as its show setting
 * says. Repositories that name the same Project share one adapter, so one read, and so do repositories that read the
 * same Azure DevOps team's sprint or backlog, which then sorts the team's work items among them by their repo- tags.
 * `run` stands in for az in tests.
 */
export function configuredSources(configs: readonly RepositoryConfig[], run: Az = az): ItemSource {
  const projects = new Map<string, ItemSource>();
  // Azure DevOps names ignore case.
  const teamKey = (repo: string, kind: string, team: string) => [kind, ...repo.split('/').slice(0, 2).map(decoded), team].join('/').toLowerCase();
  const teams = new Map<string, string[]>();
  for (const { repo, itemSource } of configs) {
    if (itemSource.kind !== 'azure-sprint' && itemSource.kind !== 'azure-backlog') continue;
    const key = teamKey(repo, itemSource.kind, itemSource.team);
    teams.set(key, [...teams.get(key) ?? [], repo]);
  }
  const azure = new Map<string, ItemSource>();
  const teamSource = (repo: string, kind: 'azure-sprint' | 'azure-backlog', team: string) => {
    const key = teamKey(repo, kind, team);
    if (!azure.has(key)) azure.set(key, (kind === 'azure-sprint' ? azureSprint : azureBacklog)(teams.get(key)!, team, run));
    return azure.get(key)!;
  };
  const byRepo = new Map(configs.map(({ repo, itemSource }): [string, ItemSource] => {
    if (itemSource.kind === 'issues') return [repo, repoIssues(repo)];
    if (itemSource.kind === 'azure-sprint' || itemSource.kind === 'azure-backlog') return [repo, teamSource(repo, itemSource.kind, itemSource.team)];
    const key = `${itemSource.owner.toLowerCase()}/${itemSource.number}`;
    if (!projects.has(key)) projects.set(key, githubProject(itemSource));
    return [repo, projects.get(key)!];
  }));
  const optedIn = configs.filter((c) => c.show === 'opted-in').map((c) => c.repo);
  return mergeSources([...projects.values()], byRepo, optedIn);
}

/**
 * Merges the Projects and the other sources, each standing for the repositories `byRepo` gives it. A read lists every
 * source's items under the first source's title, the first Project's when there is one; an item two sources list shows
 * once, as the first lists it, Projects first. A write goes to the source that last listed the item, or, for an item
 * none has listed, to the source its repository names, else the first Project. A read fails whole when any source's
 * read fails, so items never vanish on a passing error; a source other than a Project starts its error with its
 * repositories, so the user knows which repository to fix. A ReadProblem from a source other than a Project leaves out
 * only that source's items instead, and the read names the problem under each of its repositories. A read leaves out
 * each item from a repository in `optedIn` that carries no status, except a closed item a Project lists: being in a
 * Project opts it in. An untagged item that carries no status leaves the opted-in repositories of its `untaggedFor`.
 */
export function mergeSources(projects: readonly ItemSource[], byRepo: ReadonlyMap<string, ItemSource>, optedIn: readonly string[] = []): ItemSource {
  const sourceByRepo = new Map([...byRepo].map(([repo, source]) => [repo.toLowerCase(), source]));
  const optIn = new Set(optedIn.map((repo) => repo.toLowerCase()));
  const optedOut = (repo: string | null) => optIn.has(repo?.toLowerCase() ?? '');
  /** The item as a read shows it, or null when it's left out. */
  const shown = (item: Item, source: ItemSource): Item | null => {
    if (item.statuses.length > 0 || (item.state === 'closed' && projects.includes(source))) return item;
    if (!item.untaggedFor) return optedOut(item.repo) ? null : item;
    const kept = item.untaggedFor.filter((repo) => !optedOut(repo));
    if (kept.length === item.untaggedFor.length) return item;
    return kept.length ? { ...item, repo: kept[0]!, untaggedFor: kept } : null;
  };
  const sources = [...new Set([...projects, ...byRepo.values()])];
  const named = new Map<ItemSource, string[]>();
  for (const [repo, source] of byRepo) if (!projects.includes(source)) named.set(source, [...named.get(source) ?? [], repo]);
  const readOf = (source: ItemSource): Promise<ItemsRead> => {
    const repos = named.get(source);
    return repos === undefined ? source.read() : source.read().catch((err: unknown) => {
      if (err instanceof ReadProblem) return { title: '', items: [], problems: repos.map((repo) => ({ repo, problem: err.message, ...err.fix !== undefined && { fix: err.fix } })) };
      throw new Error(`${repos.join(', ')}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    });
  };
  /** The source that listed each item, by Item.id, in the last read. */
  let listedBy = new Map<string, ItemSource>();
  const forRepo = (repo: string | null) => (repo && sourceByRepo.get(repo.toLowerCase())) || projects[0] || unlisted;
  const sourceOf = (item: Item) => listedBy.get(item.id) ?? forRepo(item.repo);
  return {
    async read() {
      const reads = await Promise.all(sources.map(readOf));
      const listed = new Map<string, ItemSource>();
      const items = reads.flatMap((read, index) => read.items.filter((item) => {
        if (listed.has(item.id)) return false;
        listed.set(item.id, sources[index]!);
        return true;
      }));
      listedBy = listed;
      const problems = reads.flatMap((read) => read.problems ?? []);
      return { title: reads[0]?.title ?? '', items: items.flatMap((item) => shown(item, listed.get(item.id)!) ?? []), ...problems.length > 0 && { problems } };
    },
    setStatus: (item, status) => sourceOf(item).setStatus(item, status),
    statusRefusal: (item) => ('id' in item ? sourceOf(item) : forRepo(item.repo)).statusRefusal(item),
    addLabel: (item, label) => sourceOf(item).addLabel(item, label),
    create: (draft, progress) => forRepo(draft.repo).create(draft, progress),
    setParentStatus: (parent, status) => forRepo(parent.repo).setParentStatus(parent, status),
    abandon: (item) => sourceOf(item).abandon(item),
    renamedId: (savedId) => sources.map((source) => source.renamedId?.(savedId)).find((id) => id !== undefined),
  };
}

/** The onboarded repositories' item source, with the repositories it last read. */
export interface OnboardedSources extends ItemSource {
  /** The repositories as the last read found them, none before it. */
  repos(): RepoConfig[];
}

/**
 * The item source the onboarded repositories name as `load` reads their configs now: each read loads them first and
 * builds the merged source again when they changed, so a config merged to a default branch shows on the next read. A
 * read leaves out the items of each repository whose config `load` couldn't read or that is resetting, which a Project
 * may still list. A write goes through the source the last read built.
 */
export function onboardedSources(load: () => Promise<OnboardedConfigs>, build = configuredSources): OnboardedSources {
  let configs: RepositoryConfig[] = [];
  let current = build(configs);
  let key = JSON.stringify(configs);
  return {
    async read() {
      const loaded = await load();
      configs = loaded.configs;
      if (JSON.stringify(configs) !== key) {
        current = build(configs);
        key = JSON.stringify(configs);
      }
      const leftOff = new Set([...loaded.problems.map((p) => p.repo), ...loaded.resetting].map((repo) => repo.toLowerCase()));
      const read = await current.read();
      return { ...read, items: read.items.filter((item) => !leftOff.has(item.repo?.toLowerCase() ?? '')) };
    },
    repos: () => configs.map(repoView),
    setStatus: (item, status) => current.setStatus(item, status),
    statusRefusal: (item) => current.statusRefusal(item),
    addLabel: (item, label) => current.addLabel(item, label),
    create: (draft, progress) => current.create(draft, progress),
    setParentStatus: (parent, status) => current.setParentStatus(parent, status),
    abandon: (item) => current.abandon(item),
    renamedId: (savedId) => current.renamedId?.(savedId),
  };
}
