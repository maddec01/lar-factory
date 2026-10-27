// The Azure DevOps sprint item source: reads one team's current sprint through az, read only for now.
// A work item keeps its status as a status-<name> tag in System.Tags, and every other tag is a label.
// Only the team's requirement backlog level's types show at the top level, each with its Tasks as children,
// and each type's state categories decide what is Done (Completed) and what is hidden (Removed).

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STATUSES, carriesTwoStatuses, keepOneText, labelStatuses, statusLabel } from '@lar-factory/shared';
import type { Blocker, IssueRef, Item, Status } from '@lar-factory/shared';
import { ReadProblem, type ItemSource } from '../items/item-source.ts';
import { runTool } from '../tools/run-tool.ts';
import { missingTool, toolCommand } from '../tools/tools.ts';

/** Runs az with these arguments and resolves with its output, or throws its error. */
export type Az = (args: string[]) => Promise<string>;

/** The REST API version every `az devops invoke` call passes, as invoke's own default is 5.0. */
const API_VERSION = '7.1';
/** The most ids one workitemsbatch call reads. */
const BATCH = 200;
const READ_ONLY = 'The board reads Azure DevOps work items but does not write them yet. Change it in Azure DevOps.';

async function az(args: string[]): Promise<string> {
  const command = toolCommand('az');
  if (!command) throw new ReadProblem(`${missingTool('az')}.`, 'brew install azure-cli');
  const result = await runTool(command.file, args, { env: command.env, timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (result.code !== 0) throw new Error(`az ${args.slice(0, 3).join(' ')} failed: ${result.detail}`);
  return result.stdout;
}

/** A logged-out az or a missing azure-devops extension as the ReadProblem that names its fix; any other error as it is. */
function problemOf(err: unknown): unknown {
  const text = err instanceof Error ? err.message : String(err);
  if (/az login/i.test(text)) return new ReadProblem('az is logged out.', 'az login');
  if (/azure-devops|misspelled or not recognized/i.test(text)) return new ReadProblem('az has no azure-devops extension.', 'az extension add --name azure-devops');
  return err;
}

interface RawWorkItem {
  id: number;
  fields: Record<string, unknown>;
  relations?: { rel: string; url: string }[] | null;
}

type Category = 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const field = (raw: RawWorkItem, name: string) => text(raw.fields[name]);
/** The ids a work item's links of `rel` point at: the last part of each link's URL. */
const linked = (raw: RawWorkItem, rel: string) => (raw.relations ?? []).filter((r) => r.rel === rel).map((r) => Number(r.url.split('/').at(-1)));
const tagsOf = (raw: RawWorkItem) => field(raw, 'System.Tags').split(';').map((t) => t.trim()).filter(Boolean);
const STATUS_TAGS = new Set(STATUSES.flatMap((s) => (s === 'Done' ? [] : [statusLabel(s)])));

/** A name with its URL encoding undone, or as it is when that encoding is broken. */
function decoded(name: string): string {
  try { return decodeURIComponent(name); }
  catch { return name; }
}

/** Why a move of an open item carrying more than one status tag is refused, or null. */
const twoStatuses = (item: { statuses: readonly Status[]; state: 'open' | 'closed' }): string | null =>
  (carriesTwoStatuses(item) ? keepOneText(item.statuses) : null);

/**
 * The current sprint of `team` in the project of `repo`, an Azure DevOps repository named organization/project/repository
 * as its origin URL has them.
 * `run` stands in for az in tests. No current iteration, a logged-out az and a missing azure-devops extension are each a
 * ReadProblem with its fix.
 */
export function azureSprint(repo: string, team: string, run: Az = az): ItemSource {
  const [organization, encoded] = repo.split('/') as [string, string];
  // The repository's name keeps its origin URL's encoding; az takes the project's name itself.
  const project = decoded(encoded);
  const org = ['--org', `https://dev.azure.com/${organization}`, '--detect', 'false', '--output', 'json'];
  const call = async <T>(args: string[]): Promise<T> => {
    try { return JSON.parse(await run([...args, ...org])) as T; }
    catch (err) { throw problemOf(err); }
  };
  const boards = <T>(args: string[]) => call<T>(['boards', 'iteration', 'team', ...args, '--team', team, '--project', project]);
  const invoke = <T>(area: string, resource: string, route: string[], more: string[] = []) =>
    call<T>(['devops', 'invoke', '--area', area, '--resource', resource, '--route-parameters', `project=${project}`, ...route, ...more, '--api-version', API_VERSION]);

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

  return {
    async read() {
      const [iteration] = await boards<{ id: string; name: string }[]>(['list', '--timeframe', 'current']);
      if (!iteration) {
        throw new ReadProblem(`Team ${team} has no current iteration in ${organization}/${project}. `
          + 'Give the team a sprint whose dates cover today in its project settings, or name another team in .lar-factory.json.');
      }
      const [listed, backlog] = await Promise.all([
        boards<{ workItemRelations: { target: { id: number } }[] }>(['list-work-items', '--id', iteration.id]),
        invoke<{ requirementBacklog: { workItemTypes: { name: string }[] }; taskBacklog: { workItemTypes: { name: string }[] } }>(
          'work', 'backlogconfiguration', [`team=${team}`]),
      ]);
      const ids = [...new Set(listed.workItemRelations.map((r) => r.target.id))];
      const sprint = await workItems(ids);
      const inSprint = new Set(sprint.map((raw) => raw.id));
      const outside = [...new Set(sprint.flatMap((raw) => linked(raw, 'System.LinkTypes.Dependency-Reverse')))].filter((id) => !inSprint.has(id));
      const all = [...sprint, ...await workItems(outside)];
      const byId = new Map(all.map((raw) => [raw.id, raw]));
      const type = (raw: RawWorkItem) => field(raw, 'System.WorkItemType');
      const categoryOf = await categories([...new Set(all.map(type))]);
      const category = (raw: RawWorkItem) => categoryOf(type(raw), field(raw, 'System.State'));
      const requirements = new Set(backlog.requirementBacklog.workItemTypes.map((t) => t.name));
      const tasks = new Set(backlog.taskBacklog.workItemTypes.map((t) => t.name));

      const url = (id: number) => `https://dev.azure.com/${organization}/${encoded}/_workitems/edit/${id}`;
      const done = (raw: RawWorkItem) => category(raw) === 'Completed';
      const ref = (raw: RawWorkItem): IssueRef => ({ number: raw.id, title: field(raw, 'System.Title'), url: url(raw.id), repo, state: done(raw) ? 'closed' : 'open' });
      const blocker = (id: number): Blocker => {
        const raw = byId.get(id);
        // A Removed predecessor no longer holds anything up; one the board can't read is taken as open.
        const closed = raw !== undefined && (done(raw) || category(raw) === 'Removed');
        return { number: id, repo, state: closed ? 'closed' : 'open' };
      };
      const shown = (raw: RawWorkItem) => category(raw) !== 'Removed';
      const top = sprint.filter((raw) => requirements.has(type(raw)) && shown(raw));
      const childrenOf = (parent: RawWorkItem) => sprint.filter((raw) => tasks.has(type(raw)) && shown(raw) && Number(raw.fields['System.Parent']) === parent.id);
      const item = (raw: RawWorkItem, parent: RawWorkItem | null, children: RawWorkItem[]): Item => {
        const tags = tagsOf(raw);
        const statuses = labelStatuses(tags);
        const closed = done(raw);
        return {
          id: `azure:${organization.toLowerCase()}/${raw.id}`,
          status: closed ? 'Done' : statuses[0] ?? 'List',
          statuses,
          content: 'ticket',
          number: raw.id,
          title: field(raw, 'System.Title'),
          url: url(raw.id),
          repo,
          labels: tags.filter((t) => !STATUS_TAGS.has(t)),
          state: closed ? 'closed' : 'open',
          closedAs: closed ? 'done' : null,
          parent: parent && ref(parent),
          subIssues: { total: children.length, completed: children.filter(done).length },
          blockers: linked(raw, 'System.LinkTypes.Dependency-Reverse').map(blocker),
          updatedAt: field(raw, 'System.ChangedDate'),
          closedAt: closed ? field(raw, 'Microsoft.VSTS.Common.ClosedDate') || field(raw, 'System.ChangedDate') : null,
          linkedPrs: [],
          slices: [],
        };
      };
      const items = top.flatMap((raw) => {
        const children = childrenOf(raw);
        return [item(raw, null, children), ...children.map((child) => item(child, raw, []))];
      });
      return { title: `${team} ${iteration.name}`, items };
    },
    setStatus: async () => READ_ONLY,
    statusRefusal: (item) => ('statuses' in item ? twoStatuses(item) : null) ?? READ_ONLY,
    addLabel: async () => READ_ONLY,
    create: async () => ({ item: null, issueUrl: null, error: READ_ONLY }),
    setParentStatus: async () => READ_ONLY,
    abandon: async () => READ_ONLY,
  };
}
