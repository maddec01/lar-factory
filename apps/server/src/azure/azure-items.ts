// What the Azure DevOps item sources share: reading a team's work items through az, and writing them through azure-writes.ts.
// A work item keeps its status as a status-<name> tag in System.Tags, and every other tag is a label.
// Only the team's requirement backlog level's types show at the top level, each with its Tasks as children,
// and each type's state categories decide what is Done (Completed) and what is hidden (Removed).
// A repo-<name> tag says which of the repositories reading the source a work item is for; an untagged one is for each.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STATUSES, decodePart, labelStatuses, repoTag, statusLabel } from '@lar-factory/shared';
import type { Blocker, IssueRef, Item, LinkedPr } from '@lar-factory/shared';
import { ReadProblem, type ItemSource } from '../items/item-source.ts';
import { runTool } from '../tools/run-tool.ts';
import { missingTool, toolCommand } from '../tools/tools.ts';
import { azureCreate } from './azure-create.ts';
import { linkedPr, prIds, type AzurePr } from './azure-prs.ts';
import { azureWrites } from './azure-writes.ts';

/** Runs az with these arguments and resolves with its output, or throws its error. */
export type Az = (args: string[]) => Promise<string>;

/** The REST API version every `az devops invoke` call passes, as invoke's own default is 5.0. */
export const API_VERSION = '7.1';
/** The flags every az call ends with: the organization, no organization read from the checkout, and JSON output. */
export const orgFlags = (organization: string): string[] => ['--org', `https://dev.azure.com/${organization}`, '--detect', 'false', '--output', 'json'];
/** The most ids one workitemsbatch call reads. */
const BATCH = 200;
/** How long a source keeps its team's backlog levels and each type's states, which change only when someone edits the process. */
export const SETTINGS_TTL = 10 * 60_000;
/** The most az repos pr show calls a read runs at once. */
export const PR_READS = 4;

/** `read`'s answer, kept for SETTINGS_TTL by `now`'s clock; a failed read isn't kept, so the next call reads again. */
function kept<T>(read: () => Promise<T>, now: () => number): () => Promise<T> {
  let last: { answer: Promise<T>; at: number } | undefined;
  return () => {
    if (!last || now() - last.at >= SETTINGS_TTL) {
      const answer = read();
      last = { answer, at: now() };
      answer.catch(() => { if (last?.answer === answer) last = undefined; });
    }
    return last.answer;
  };
}

/** `each` on every one of `values`, at most `limit` at once, its answers in their order. */
async function limited<T, R>(values: readonly T[], limit: number, each: (value: T) => Promise<R>): Promise<R[]> {
  const answers: R[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const i = next++;
      answers[i] = await each(values[i]!);
    }
  }));
  return answers;
}

export async function az(args: string[]): Promise<string> {
  const command = toolCommand('az');
  if (!command) throw new ReadProblem(`${missingTool('az')}.`, 'brew install azure-cli');
  const result = await runTool(command.file, args, { env: command.env, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (result.code !== 0) throw new Error(`az ${args.slice(0, 3).join(' ')} failed: ${result.detail}`);
  return result.stdout;
}

/** A logged-out az or a missing azure-devops extension as the ReadProblem that names its fix; any other error as it is. */
export function problemOf(err: unknown): unknown {
  const text = err instanceof Error ? err.message : String(err);
  if (/az login/i.test(text)) return new ReadProblem('az is logged out.', 'az login');
  if (/azure-devops|misspelled or not recognized/i.test(text)) return new ReadProblem('az has no azure-devops extension.', 'az extension add --name azure-devops');
  return err;
}

/** Runs `use` on a temporary file holding `body` as JSON, for az's --in-file, and removes the file after. */
export async function withFile<T>(body: unknown, use: (file: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'lar-azure-'));
  try {
    const file = join(dir, 'body.json');
    await writeFile(file, JSON.stringify(body));
    return await use(file);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface RawWorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: { rel: string; url: string }[] | null;
}

type Category = 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
export const field = (raw: RawWorkItem, name: string) => text(raw.fields[name]);
/** The ids a work item's links of `rel` point at: the last part of each link's URL. */
const linked = (raw: RawWorkItem, rel: string) => (raw.relations ?? []).filter((r) => r.rel === rel).map((r) => Number(r.url.split('/').at(-1)));
/** The work item's tags, from System.Tags's "a; b". */
export const tagsOf = (raw: RawWorkItem) => field(raw, 'System.Tags').split(';').map((t) => t.trim()).filter(Boolean);
const STATUS_TAGS = new Set(STATUSES.flatMap((s) => (s === 'Done' ? [] : [statusLabel(s)])));
/** Whether the tag records a work item's repository; Azure keeps a tag's case, so the board ignores it. */
export const isRepoTag = (tag: string) => tag.toLowerCase().startsWith('repo-');

/** Where a work item shows: for its tagged repository, untagged for each of the source's, or nowhere (null). */
type Placement = Pick<Item, 'repo' | 'untaggedFor'> | null;

/**
 * The work item's placement among `repos`, the repositories reading its source: the one its repo- tag names,
 * whatever the case, or each of them when it has none. A tag for another repository, or two tags, hide it.
 */
function placement(tags: readonly string[], repos: readonly string[]): Placement {
  const tagged = tags.filter(isRepoTag);
  if (tagged.length === 0) return { repo: repos[0]!, untaggedFor: [...repos] };
  const repo = tagged.length === 1 ? repos.find((r) => repoTag(r).toLowerCase() === tagged[0]!.toLowerCase()) : undefined;
  return repo === undefined ? null : { repo };
}

/** The team's backlog levels: the requirement level's id, types and default type, and the task level's types. */
interface BacklogConfiguration {
  requirementBacklog: { id: string; workItemTypes: { name: string }[]; defaultWorkItemType: { name: string } };
  taskBacklog: { workItemTypes: { name: string }[] };
}

/** The az calls a lister makes, each naming the team's organization and project. */
export interface AzureCalls {
  organization: string;
  /** The project's name, its URL encoding undone. */
  project: string;
  /** `az boards iteration team <args>` for the team. */
  boards: <T>(args: string[]) => Promise<T>;
  /** `az devops invoke` on the area's resource, routed to the project and then `route`, at REST API `version` (7.1 by default). */
  invoke: <T>(area: string, resource: string, route: string[], more?: string[], version?: string) => Promise<T>;
  /** The work items' fields and links, reading at most 200 ids a call; an id az no longer finds is left out. */
  workItems: (ids: readonly number[]) => Promise<RawWorkItem[]>;
  /** The team's backlog levels, kept for SETTINGS_TTL. */
  backlog: Promise<BacklogConfiguration>;
}

/** What a lister found: the board's title and the work items to show. */
export interface Listing {
  title: string;
  /** The requirement-level items, and any other work item the listing holds; the read adds each item's Tasks through its child links. */
  items: RawWorkItem[];
  /** Whether a Completed requirement-level item shows, as Done; a Completed Task always does. */
  completed: boolean;
}

/**
 * The item source that shows what `list` finds for `team` in the project of `repos`, the Azure DevOps repositories
 * reading it, each named organization/project/repository as its origin URL has them, all in one project.
 * The team's backlog levels and each type's states are kept for SETTINGS_TTL, by `now`'s clock.
 * `run` stands in for az in tests. A logged-out az and a missing azure-devops extension are each a ReadProblem with its fix.
 */
export function azureItems(repos: readonly string[], team: string, list: (calls: AzureCalls) => Promise<Listing>, run: Az = az,
  now: () => number = Date.now): ItemSource {
  const [organization, encoded] = repos[0]!.split('/') as [string, string];
  // The repository's name keeps its origin URL's encoding; az takes the project's name itself.
  const project = decodePart(encoded);
  const org = orgFlags(organization);
  const call = async <T>(args: string[]): Promise<T> => {
    try { return JSON.parse(await run([...args, ...org])) as T; }
    catch (err) { throw problemOf(err); }
  };
  const boards = <T>(args: string[]) => call<T>(['boards', 'iteration', 'team', ...args, '--team', team, '--project', project]);
  const invoke = <T>(area: string, resource: string, route: string[], more: string[] = [], version = API_VERSION) =>
    call<T>(['devops', 'invoke', '--area', area, '--resource', resource, '--route-parameters', `project=${project}`, ...route, ...more, '--api-version', version]);
  const backlogOf = kept(() => invoke<BacklogConfiguration>('work', 'backlogconfiguration', [`team=${team}`]), now);
  const typeStates = new Map<string, () => Promise<{ value: { name: string; category: Category }[] }>>();
  /** The type's states, each with its category. */
  const statesOf = (type: string) => {
    if (!typeStates.has(type)) typeStates.set(type, kept(() => invoke<{ value: { name: string; category: Category }[] }>('wit', 'workitemtypestates', [`type=${type}`]), now));
    return typeStates.get(type)!();
  };
  const url = (id: number) => `https://dev.azure.com/${organization}/${encoded}/_workitems/edit/${id}`;
  const itemId = (id: number) => `azure:${organization.toLowerCase()}/${id}`;
  const labelsOf = (raw: RawWorkItem) => tagsOf(raw).filter((t) => !STATUS_TAGS.has(t) && !isRepoTag(t));

  /** The work items' fields and links, reading at most BATCH ids a call; an id az no longer finds is left out. */
  async function workItems(ids: readonly number[]): Promise<RawWorkItem[]> {
    if (!ids.length) return [];
    const batches = Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ids.slice(i * BATCH, (i + 1) * BATCH));
    const reads = await Promise.all(batches.map((batch) => withFile({ ids: batch, $expand: 'Relations', errorPolicy: 'Omit' }, (file) =>
      invoke<{ value: (RawWorkItem | null)[] }>('wit', 'workitemsbatch', [], ['--http-method', 'POST', '--in-file', file]))));
    return reads.flatMap((read) => read.value.filter((raw): raw is RawWorkItem => raw !== null));
  }

  /** Each type's state categories, by type and state name. */
  async function categories(types: readonly string[]): Promise<Map<string, Map<string, Category>>> {
    const read = await Promise.all(types.map(statesOf));
    return new Map(types.map((type, i) => [type, new Map(read[i]!.value.map((s) => [s.name, s.category]))]));
  }

  /** The PRs the work items link, each read once, PR_READS at once, by id; a PR az no longer finds is left out. */
  async function prsOf(raws: readonly RawWorkItem[]): Promise<Map<number, LinkedPr>> {
    const ids = [...new Set(raws.flatMap(prIds))];
    const read = await limited(ids, PR_READS, (id) => call<AzurePr>(['repos', 'pr', 'show', '--id', String(id)]).catch((err: unknown) => {
      // TF401180 is Azure's "pull request was not found".
      if (err instanceof Error && /TF401180/.test(err.message)) return null;
      throw err;
    }));
    return new Map(read.flatMap((pr) => (pr ? [[pr.pullRequestId, linkedPr(pr)] as const] : [])));
  }

  return {
    async read() {
      const backlog = backlogOf();
      const [{ title, items: listed, completed }, levels] = await Promise.all([
        list({ organization, project, boards, invoke, workItems, backlog }), backlog]);
      const type = (raw: RawWorkItem) => field(raw, 'System.WorkItemType');
      const requirements = new Set(levels.requirementBacklog.workItemTypes.map((t) => t.name));
      const tasks = new Set(levels.taskBacklog.workItemTypes.map((t) => t.name));
      /** The ids the work items link by `rel` that `known` lacks, each once. */
      const unread = (raws: readonly RawWorkItem[], rel: string, known: readonly RawWorkItem[]) => {
        const ids = new Set(known.map((raw) => raw.id));
        return [...new Set(raws.flatMap((raw) => linked(raw, rel)))].filter((id) => !ids.has(id));
      };
      // A requirement-level item's Tasks come through its child links, so a sprint shows one in another iteration too.
      const parents = listed.filter((raw) => requirements.has(type(raw)));
      const withTasks = [...listed, ...await workItems(unread(parents, 'System.LinkTypes.Hierarchy-Forward', listed))];
      const all = [...withTasks, ...await workItems(unread(withTasks, 'System.LinkTypes.Dependency-Reverse', withTasks))];
      const byId = new Map(all.map((raw) => [raw.id, raw]));
      const byType = await categories([...new Set(all.map(type))]);
      const category = (raw: RawWorkItem) => byType.get(type(raw))?.get(field(raw, 'System.State'));
      // Abandon moves a work item to its type's Removed-category state, which Basic's Issue lacks.
      const abandonRefusal = (raw: RawWorkItem) => ([...byType.get(type(raw))?.values() ?? []].includes('Removed') ? {}
        : { abandonRefusal: `${type(raw)} has no Removed state in ${project}, so the board can't abandon it. Close or delete it in Azure DevOps.` });

      const done = (raw: RawWorkItem) => category(raw) === 'Completed';
      const shown = (raw: RawWorkItem) => category(raw) !== 'Removed';
      // Each shown requirement-level item and its shown Tasks, placed in one pass before any item is built: the item by
      // its tags, and each Task by its own, or with its parent when it has no repo- tag. A hidden item hides its Tasks.
      const placed = new Map<number, NonNullable<Placement>>();
      const childrenOf = new Map<number, RawWorkItem[]>();
      for (const raw of listed) {
        if (!requirements.has(type(raw)) || !shown(raw) || (!completed && done(raw))) continue;
        const where = placement(tagsOf(raw), repos);
        if (!where) continue;
        placed.set(raw.id, where);
        childrenOf.set(raw.id, withTasks.filter((child) => tasks.has(type(child)) && shown(child) && Number(child.fields['System.Parent']) === raw.id)
          .filter((child) => {
            const tags = tagsOf(child);
            const own = tags.some(isRepoTag) ? placement(tags, repos) : where;
            if (own) placed.set(child.id, own);
            return own !== null;
          }));
      }
      const top = listed.filter((raw) => childrenOf.has(raw.id));
      // An item outside the listing, such as a predecessor, goes by its own tags.
      const repoOf = (raw: RawWorkItem | undefined) => (raw && (placed.get(raw.id) ?? placement(tagsOf(raw), repos))?.repo) || repos[0]!;
      const ref = (raw: RawWorkItem): IssueRef => ({ number: raw.id, title: field(raw, 'System.Title'), url: url(raw.id), repo: repoOf(raw), state: done(raw) ? 'closed' : 'open' });
      const blocker = (id: number): Blocker => {
        const raw = byId.get(id);
        // A Removed predecessor no longer holds anything up; one the board can't read is taken as open.
        const closed = raw !== undefined && (done(raw) || category(raw) === 'Removed');
        return { number: id, repo: repoOf(raw), state: closed ? 'closed' : 'open' };
      };
      const item = (raw: RawWorkItem, parent: RawWorkItem | null, children: RawWorkItem[]): Item => {
        const tags = tagsOf(raw);
        const statuses = labelStatuses(tags);
        const closed = done(raw);
        return {
          id: itemId(raw.id),
          status: closed ? 'Done' : statuses[0] ?? 'List',
          statuses,
          content: 'ticket',
          number: raw.id,
          title: field(raw, 'System.Title'),
          url: url(raw.id),
          ...placed.get(raw.id)!,
          ...abandonRefusal(raw),
          labels: labelsOf(raw),
          state: closed ? 'closed' : 'open',
          closedAs: closed ? 'done' : null,
          parent: parent && ref(parent),
          subIssues: { total: children.length, completed: children.filter(done).length },
          blockers: linked(raw, 'System.LinkTypes.Dependency-Reverse').map(blocker),
          updatedAt: field(raw, 'System.ChangedDate'),
          closedAt: closed ? field(raw, 'Microsoft.VSTS.Common.ClosedDate') || field(raw, 'System.ChangedDate') : null,
          linkedPrs: prIds(raw).flatMap((id) => shownPrs.get(id) ?? []),
          slices: [],
        };
      };
      const shownPrs = await prsOf([...top, ...top.flatMap((raw) => childrenOf.get(raw.id)!)]);
      const items = top.flatMap((raw) => {
        const children = childrenOf.get(raw.id)!;
        return [item(raw, null, children), ...children.map((child) => item(child, raw, []))];
      });
      return { title, items };
    },
    ...azureWrites(project, invoke, statesOf),
    // A new work item is in its type's first state, Proposed, so it shows open in List.
    create: azureCreate(project, invoke, async () => (await backlogOf()).requirementBacklog.defaultWorkItemType.name, (raw, draft) => ({
      id: itemId(raw.id), status: 'List', statuses: ['List'], content: 'ticket', number: raw.id, title: field(raw, 'System.Title'),
      url: url(raw.id), repo: draft.repo, ...!draft.onlyFor && { untaggedFor: [...repos] }, labels: labelsOf(raw), state: 'open', closedAs: null, parent: null, subIssues: { total: 0, completed: 0 },
      blockers: [], updatedAt: field(raw, 'System.ChangedDate'), closedAt: null, linkedPrs: [], slices: [],
    })),
  };
}
