// A fake az for the Azure DevOps item sources' tests, answering from a list of work items.

import { readFileSync } from 'node:fs';

export interface WorkItem {
  id: number;
  type: string;
  state: string;
  title?: string;
  tags?: string;
  parent?: number;
  predecessors?: number[];
  closed?: string;
  /** Its area path; the team's own area when absent. */
  area?: string;
}

/** The fake team's area path, which its area paths include with their children unless a test says otherwise. */
export const TEAM_AREA = 'Fabrikam Fiber\\Fabrikam Team';

/** Each process's states with their categories, as the work item type states endpoint lists them. */
export const STATES: Record<string, [string, string][]> = {
  'User Story': [['New', 'Proposed'], ['Active', 'InProgress'], ['Resolved', 'Resolved'], ['Closed', 'Completed'], ['Removed', 'Removed']],
  'Product Backlog Item': [['New', 'Proposed'], ['Approved', 'Proposed'], ['Committed', 'InProgress'], ['Done', 'Completed'], ['Removed', 'Removed']],
  'Issue': [['To Do', 'Proposed'], ['Doing', 'InProgress'], ['Done', 'Completed']],
  'Requirement': [['Proposed', 'Proposed'], ['Active', 'InProgress'], ['Resolved', 'Resolved'], ['Closed', 'Completed']],
  'Task': [['New', 'Proposed'], ['Active', 'InProgress'], ['Closed', 'Completed'], ['Removed', 'Removed']],
  'Epic': [['New', 'Proposed'], ['Active', 'InProgress'], ['Closed', 'Completed'], ['Removed', 'Removed']],
};

/**
 * A fake az for one team whose current sprint holds `sprint`'s ids and whose requirement backlog lists `backlog`'s,
 * reading `items` (listed or not), with `requirement` its requirement backlog level's type and `areas` its area paths.
 * It records each call, and `fail` throws for a call it matches.
 */
export function fakeAz({ items, sprint = items.map((i) => i.id), backlog = items.filter((i) => i.type !== 'Task').map((i) => i.id),
  requirement = 'User Story', areas = [{ value: TEAM_AREA, includeChildren: true }], iterations = [{ id: 'it-12', name: 'Sprint 12' }], fail }: {
  items: WorkItem[];
  sprint?: number[];
  backlog?: number[];
  requirement?: string;
  areas?: { value: string; includeChildren: boolean }[];
  iterations?: { id: string; name: string }[];
  fail?: (args: string[]) => Error | undefined;
}) {
  const calls: string[][] = [];
  /** Each workitemsbatch call's ids, read from its --in-file while the file exists. */
  const batches: number[][] = [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const flag = (args: string[], name: string) => args[args.indexOf(name) + 1]!;
  const route = (args: string[], key: string) => args.find((a) => a.startsWith(`${key}=`))?.slice(key.length + 1);
  const raw = (i: WorkItem) => ({
    id: i.id, rev: 1, url: `https://dev.azure.com/contoso/_apis/wit/workItems/${i.id}`,
    fields: {
      'System.WorkItemType': i.type, 'System.State': i.state, 'System.AreaPath': i.area ?? TEAM_AREA, 'System.Title': i.title ?? `Item ${i.id}`, 'System.ChangedDate': '2026-10-21T08:00:00Z',
      ...i.tags && { 'System.Tags': i.tags }, ...i.parent && { 'System.Parent': i.parent }, ...i.closed && { 'Microsoft.VSTS.Common.ClosedDate': i.closed },
    },
    relations: [
      ...i.parent ? [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: `https://dev.azure.com/contoso/_apis/wit/workItems/${i.parent}`, attributes: {} }] : [],
      ...items.filter((child) => child.parent === i.id)
        .map((child) => ({ rel: 'System.LinkTypes.Hierarchy-Forward', url: `https://dev.azure.com/contoso/_apis/wit/workItems/${child.id}`, attributes: {} })),
      ...(i.predecessors ?? []).map((p) => ({ rel: 'System.LinkTypes.Dependency-Reverse', url: `https://dev.azure.com/contoso/_apis/wit/workItems/${p}`, attributes: {} })),
      { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/x', attributes: {} },
    ],
  });
  const run = async (args: string[]) => {
    calls.push(args);
    const failure = fail?.(args);
    if (failure) throw failure;
    const command = args.slice(0, 4).join(' ');
    if (command === 'boards iteration team list') return JSON.stringify(iterations.map((it) => ({ ...it, path: `Fabrikam Fiber\\${it.name}` })));
    if (command === 'boards iteration team list-work-items') {
      return JSON.stringify({ workItemRelations: sprint.map((id) => {
        const parent = byId.get(id)?.parent;
        return parent && sprint.includes(parent)
          ? { rel: 'System.LinkTypes.Hierarchy-Forward', source: { id: parent }, target: { id } }
          : { rel: null, source: null, target: { id } };
      }) });
    }
    if (args[0] === 'devops' && args[1] === 'invoke') {
      const resource = `${flag(args, '--area')}/${flag(args, '--resource')}`;
      if (resource === 'work/backlogconfiguration') {
        return JSON.stringify({ requirementBacklog: { id: 'Microsoft.RequirementCategory', workItemTypes: [{ name: requirement }] },
          taskBacklog: { id: 'Microsoft.TaskCategory', workItemTypes: [{ name: 'Task' }] } });
      }
      if (resource === 'work/workitems' && route(args, 'backlogId') === 'Microsoft.RequirementCategory') {
        return JSON.stringify({ workItems: backlog.map((id) => ({ rel: null, source: null, target: { id, url: `https://dev.azure.com/contoso/_apis/wit/workItems/${id}` } })) });
      }
      if (resource === 'work/teamfieldvalues') {
        return JSON.stringify({ field: { referenceName: 'System.AreaPath' }, defaultValue: areas[0]?.value, values: areas });
      }
      if (resource === 'wit/workitemsbatch') {
        const { ids } = JSON.parse(readFileSync(flag(args, '--in-file'), 'utf8')) as { ids: number[] };
        batches.push(ids);
        const found = ids.flatMap((id) => byId.has(id) ? [raw(byId.get(id)!)] : []);
        return JSON.stringify({ count: found.length, value: found });
      }
      if (resource === 'wit/workitemtypestates') {
        const states = STATES[route(args, 'type')!]!;
        return JSON.stringify({ count: states.length, value: states.map(([name, category]) => ({ name, color: '000000', category })) });
      }
    }
    throw new Error(`fake az: unexpected ${args.join(' ')}`);
  };
  return { calls, batches, run };
}
