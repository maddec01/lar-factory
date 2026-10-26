// Every item source config.json names, as the one item source the board server reads and writes through.
// The board knows only the GitHub provider in this build, so each source is a GitHub adapter.

import type { Item } from '@lar-factory/shared';
import type { BoardConfig } from '../config/config.ts';
import { githubProject } from '../github/github-project.ts';
import { repoIssues } from '../github/repo-issues.ts';
import type { ItemSource } from './item-source.ts';

/** The Project for every repository, merged with the issues of each repository whose entry names them, showing each repository's items as its entry says. */
export function configuredSources(config: BoardConfig): ItemSource {
  const issues = config.repos.filter((r) => r.items === 'issues').map((r): [string, ItemSource] => [r.repo, repoIssues(r.repo)]);
  const optedIn = config.repos.filter((r) => r.show === 'opted-in').map((r) => r.repo);
  return mergeSources(githubProject(config), new Map(issues), optedIn);
}

/**
 * Merges the Project with other sources, by the repository each stands for. A read lists every source's items under
 * the Project's title; an item two sources list shows once, as the Project lists it. A write goes to the source that
 * last listed the item, or, for an item none has listed, to the source its repository names, else the Project. A read
 * fails whole when any source's read fails, so items never vanish on a passing error; another source's error starts
 * with its repository, so the user knows which repos entry to fix. A read leaves out each item from a repository in
 * `optedIn` that carries no status, except a closed item the Project lists: being in the Project opts it in.
 */
export function mergeSources(project: ItemSource, byRepo: ReadonlyMap<string, ItemSource>, optedIn: readonly string[] = []): ItemSource {
  const others = new Map([...byRepo].map(([repo, source]) => [repo.toLowerCase(), source]));
  const optIn = new Set(optedIn.map((repo) => repo.toLowerCase()));
  const shows = (item: Item, source: ItemSource) => item.statuses.length > 0 || !optIn.has(item.repo?.toLowerCase() ?? '')
    || (item.state === 'closed' && source === project);
  const sources = [project, ...others.values()];
  const named = new Map([...byRepo].map(([repo, source]) => [source, repo]));
  const readOf = (source: ItemSource) => {
    const repo = named.get(source);
    return repo === undefined ? source.read() : source.read().catch((err: unknown) => {
      throw new Error(`${repo}: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
    });
  };
  /** The source that listed each item, by Item.id, in the last read. */
  let listedBy = new Map<string, ItemSource>();
  const forRepo = (repo: string | null) => (repo && others.get(repo.toLowerCase())) || project;
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
      return { title: reads[0]!.title, items: items.filter((item) => shows(item, listed.get(item.id)!)) };
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
