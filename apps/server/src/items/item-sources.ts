// Every item source the onboarded repositories' configs name, as the one item source the board server reads and writes through.
// The board knows only the GitHub provider in this build, so each source is a GitHub adapter.

import type { Item, RepoConfig } from '@lar-factory/shared';
import type { OnboardedConfigs, RepositoryConfig } from '../config/repository-config.ts';
import { githubProject } from '../github/github-project.ts';
import { repoIssues } from '../github/repo-issues.ts';
import type { ItemSource } from './item-source.ts';

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

/** A repository's config as the page sees it: its role, item source and show setting. */
export function repoView({ repo, role, itemSource, show }: RepositoryConfig): RepoConfig {
  return { repo, role, items: itemSource.kind === 'issues' ? 'issues' : 'project', show };
}

/**
 * Each repository's item source as its config names it, merged, showing each repository's items as its show setting
 * says. Repositories that name the same Project share one adapter, so one read.
 */
function configuredSources(configs: readonly RepositoryConfig[]): ItemSource {
  const projects = new Map<string, ItemSource>();
  const byRepo = new Map(configs.map(({ repo, itemSource }): [string, ItemSource] => {
    if (itemSource.kind === 'issues') return [repo, repoIssues(repo)];
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
 * repository, so the user knows which repository to fix. A read leaves out each item from a repository in `optedIn`
 * that carries no status, except a closed item a Project lists: being in a Project opts it in.
 */
export function mergeSources(projects: readonly ItemSource[], byRepo: ReadonlyMap<string, ItemSource>, optedIn: readonly string[] = []): ItemSource {
  const sourceByRepo = new Map([...byRepo].map(([repo, source]) => [repo.toLowerCase(), source]));
  const optIn = new Set(optedIn.map((repo) => repo.toLowerCase()));
  const shows = (item: Item, source: ItemSource) => item.statuses.length > 0 || !optIn.has(item.repo?.toLowerCase() ?? '')
    || (item.state === 'closed' && projects.includes(source));
  const sources = [...new Set([...projects, ...byRepo.values()])];
  const named = new Map([...byRepo].filter(([, source]) => !projects.includes(source)).map(([repo, source]) => [source, repo]));
  const readOf = (source: ItemSource) => {
    const repo = named.get(source);
    return repo === undefined ? source.read() : source.read().catch((err: unknown) => {
      throw new Error(`${repo}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
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
      return { title: reads[0]?.title ?? '', items: items.filter((item) => shows(item, listed.get(item.id)!)) };
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
 * read leaves out the items of each repository whose config `load` couldn't read, which a Project may still list. A
 * write goes through the source the last read built.
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
      const leftOff = new Set(loaded.problems.map((p) => p.repo.toLowerCase()));
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
