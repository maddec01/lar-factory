// What the Azure DevOps item sources share: reading a team's work items through az, and writing them through azure-writes.ts.
// A work item keeps its status as a status-<name> tag in System.Tags, and every other tag is a label.
// Only the team's requirement backlog level's types show at the top level, each with its Tasks as children,
// and each type's state categories decide what is Done (Completed) and what is hidden (Removed).

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STATUSES, labelStatuses, statusLabel } from '@lar-factory/shared';
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
const API_VERSION = '7.1';
/** The most ids one workitemsbatch call reads. */
const BATCH = 200;

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

export interface RawWorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: { rel: string; url: string }[] | null;
}

type Category = 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
export const field = (raw: RawWorkItem, name: string) => text(raw.fields[name]);
/** The ids a work item's links of `rel` point at: the last part of each link's URL. */
export const linked = (raw: RawWorkItem, rel: string) => (raw.relations ?? []).filter((r) => r.rel === rel).map((r) => Number(r.url.split('/').at(-1)));
/** The work item's tags, from System.Tags's "a; b". */
export const tagsOf = (raw: RawWorkItem) => field(raw, 'System.Tags').split(';').map((t) => t.trim()).filter(Boolean);
const STATUS_TAGS = new Set(STATUSES.flatMap((s) => (s === 'Done' ? [] : [statusLabel(s)])));

/** A name with its URL encoding undone, or as it is when that encoding is broken. */
export function decoded(name: string): string {
  try { return decodeURIComponent(name); }
  catch { return name; }
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
  /** The team's backlog levels, read once a read. */
  backlog: Promise<BacklogConfiguration>;
}

/** What a lister found: the board's title and the requirement-level items and Tasks to show. */
export interface Listing {
  title: string;
  items: RawWorkItem[];
  /** Whether a Completed requirement-level item shows, as Done; a Completed Task always does. */
  completed: boolean;
}

/**
 * The item source that shows what `list` finds for `team` in the project of `repo`, an Azure DevOps repository named
 * organization/project/repository as its origin URL has them.
 * `run` stands in for az in tests. A logged-out az and a missing azure-devops extension are each a ReadProblem with its fix.
 */
export function azureItems(repo: string, team: string, list: (calls: AzureCalls) => Promise<Listing>, run: Az = az): ItemSource {
  const [organization, encoded] = repo.split('/') as [string, string];
  // The repository's name keeps its origin URL's encoding; az takes the project's name itself.
  const project = decoded(encoded);
  const org = ['--org', `https://dev.azure.com/${organization}`, '--detect', 'false', '--output', 'json'];
  const call = async <T>(args: string[]): Promise<T> => {
    try { return JSON.parse(await run([...args, ...org])) as T; }
    catch (err) { throw problemOf(err); }
  };
  const boards = <T>(args: string[]) => call<T>(['boards', 'iteration', 'team', ...args, '--team', team, '--project', project]);
  const invoke = <T>(area: string, resource: string, route: string[], more: string[] = [], version = API_VERSION) =>
    call<T>(['devops', 'invoke', '--area', area, '--resource', resource, '--route-parameters', `project=${project}`, ...route, ...more, '--api-version', version]);
  const backlogOf = () => invoke<BacklogConfiguration>('work', 'backlogconfiguration', [`team=${team}`]);
  const url = (id: number) => `https://dev.azure.com/${organization}/${encoded}/_workitems/edit/${id}`;
  const itemId = (id: number) => `azure:${organization.toLowerCase()}/${id}`;
  const labelsOf = (raw: RawWorkItem) => tagsOf(raw).filter((t) => !STATUS_TAGS.has(t));

  /** The work items' fields and links, reading at most BATCH ids a call; an id az no longer finds is left out. */
  async function workItems(ids: readonly number[]): Promise<RawWorkItem[]> {
    if (!ids.length) return [];
    const dir = await mkdtemp(join(tmpdir(), 'lar-azure-'));
    try {
      const batches = Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ids.slice(i * BATCH, (i + 1) * BATCH));
      const reads = await Promise.all(batches.map(async (batch, i) => {
        const file = join(dir, `batch-${i}.json`);
        await writeFile(file, JSON.stringify({ ids: batch, $expand: 'Relations', errorPolicy: 'Omit' }));
        return invoke<{ value: (RawWorkItem | null)[] }>('wit', 'workitemsbatch', [], ['--http-method', 'POST', '--in-file', file]);
      }));
      return reads.flatMap((read) => read.value.filter((raw): raw is RawWorkItem => raw !== null));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** Each type's state categories, by type and state name. */
  async function categories(types: readonly string[]): Promise<(type: string, state: string) => Category | undefined> {
    const read = await Promise.all(types.map((type) =>
      invoke<{ value: { name: string; category: Category }[] }>('wit', 'workitemtypestates', [`type=${type}`])));
    const byType = new Map(types.map((type, i) => [type, new Map(read[i]!.value.map((s) => [s.name, s.category]))]));
    return (type, state) => byType.get(type)?.get(state);
  }

  /** The PRs the work items link, each read once, by id; a PR az no longer finds is left out. */
  async function prsOf(raws: readonly RawWorkItem[]): Promise<Map<number, LinkedPr>> {
    const ids = [...new Set(raws.flatMap(prIds))];
    const read = await Promise.all(ids.map((id) => call<AzurePr>(['repos', 'pr', 'show', '--id', String(id)]).catch((err: unknown) => {
      // TF401180 is Azure's "pull request was not found".
      if (err instanceof Error && /TF401180/.test(err.message)) return null;
      throw err;
    })));
    return new Map(read.flatMap((pr) => (pr ? [[pr.pullRequestId, linkedPr(pr)] as const] : [])));
  }

  return {
    async read() {
      const backlog = backlogOf();
      const [{ title, items: listed, completed }, levels] = await Promise.all([
        list({ organization, project, boards, invoke, workItems, backlog }), backlog]);
      const inListing = new Set(listed.map((raw) => raw.id));
      const outside = [...new Set(listed.flatMap((raw) => linked(raw, 'System.LinkTypes.Dependency-Reverse')))].filter((id) => !inListing.has(id));
      const all = [...listed, ...await workItems(outside)];
      const byId = new Map(all.map((raw) => [raw.id, raw]));
      const type = (raw: RawWorkItem) => field(raw, 'System.WorkItemType');
      const categoryOf = await categories([...new Set(all.map(type))]);
      const category = (raw: RawWorkItem) => categoryOf(type(raw), field(raw, 'System.State'));
      const requirements = new Set(levels.requirementBacklog.workItemTypes.map((t) => t.name));
      const tasks = new Set(levels.taskBacklog.workItemTypes.map((t) => t.name));

      const done = (raw: RawWorkItem) => category(raw) === 'Completed';
      const ref = (raw: RawWorkItem): IssueRef => ({ number: raw.id, title: field(raw, 'System.Title'), url: url(raw.id), repo, state: done(raw) ? 'closed' : 'open' });
      const blocker = (id: number): Blocker => {
        const raw = byId.get(id);
        // A Removed predecessor no longer holds anything up; one the board can't read is taken as open.
        const closed = raw !== undefined && (done(raw) || category(raw) === 'Removed');
        return { number: id, repo, state: closed ? 'closed' : 'open' };
      };
      const shown = (raw: RawWorkItem) => category(raw) !== 'Removed';
      const top = listed.filter((raw) => requirements.has(type(raw)) && shown(raw) && (completed || !done(raw)));
      const childrenOf = (parent: RawWorkItem) => listed.filter((raw) => tasks.has(type(raw)) && shown(raw) && Number(raw.fields['System.Parent']) === parent.id);
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
          repo,
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
      const shownPrs = await prsOf([...top, ...top.flatMap(childrenOf)]);
      const items = top.flatMap((raw) => {
        const children = childrenOf(raw);
        return [item(raw, null, children), ...children.map((child) => item(child, raw, []))];
      });
      return { title, items };
    },
    ...azureWrites(project, invoke),
    // A new work item is in its type's first state, Proposed, so it shows open in List.
    create: azureCreate(project, invoke, async () => (await backlogOf()).requirementBacklog.defaultWorkItemType.name, (raw) => ({
      id: itemId(raw.id), status: 'List', statuses: ['List'], content: 'ticket', number: raw.id, title: field(raw, 'System.Title'),
      url: url(raw.id), repo, labels: labelsOf(raw), state: 'open', closedAs: null, parent: null, subIssues: { total: 0, completed: 0 },
      blockers: [], updatedAt: field(raw, 'System.ChangedDate'), closedAt: null, linkedPrs: [], slices: [],
    })),
  };
}
