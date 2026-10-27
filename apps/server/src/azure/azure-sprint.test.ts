import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Item } from '@lar-factory/shared';
import { mergeSources } from '../items/item-sources.ts';
import type { ItemSource } from '../items/item-source.ts';
import { azureSprint } from './azure-sprint.ts';

const REPO = 'contoso/Fabrikam%20Fiber/lar-api';
const TEAM = 'Fabrikam Team';

interface WorkItem {
  id: number;
  type: string;
  state: string;
  title?: string;
  tags?: string;
  parent?: number;
  predecessors?: number[];
  closed?: string;
}

/** Each process's states with their categories, as the work item type states endpoint lists them. */
const STATES: Record<string, [string, string][]> = {
  'User Story': [['New', 'Proposed'], ['Active', 'InProgress'], ['Resolved', 'Resolved'], ['Closed', 'Completed'], ['Removed', 'Removed']],
  'Product Backlog Item': [['New', 'Proposed'], ['Approved', 'Proposed'], ['Committed', 'InProgress'], ['Done', 'Completed'], ['Removed', 'Removed']],
  'Issue': [['To Do', 'Proposed'], ['Doing', 'InProgress'], ['Done', 'Completed']],
  'Requirement': [['Proposed', 'Proposed'], ['Active', 'InProgress'], ['Resolved', 'Resolved'], ['Closed', 'Completed']],
  'Task': [['New', 'Proposed'], ['Active', 'InProgress'], ['Closed', 'Completed'], ['Removed', 'Removed']],
  'Epic': [['New', 'Proposed'], ['Active', 'InProgress'], ['Closed', 'Completed'], ['Removed', 'Removed']],
};

/**
 * A fake az for one team whose current sprint holds `sprint`'s ids, reading `items` (in the sprint or not), with
 * `requirement` its requirement backlog level's type. It records each call, and `fail` throws for a call it matches.
 */
function fakeAz({ items, sprint = items.map((i) => i.id), requirement = 'User Story', iterations = [{ id: 'it-12', name: 'Sprint 12' }], fail }: {
  items: WorkItem[];
  sprint?: number[];
  requirement?: string;
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
      'System.WorkItemType': i.type, 'System.State': i.state, 'System.Title': i.title ?? `Item ${i.id}`, 'System.ChangedDate': '2026-10-21T08:00:00Z',
      ...i.tags && { 'System.Tags': i.tags }, ...i.parent && { 'System.Parent': i.parent }, ...i.closed && { 'Microsoft.VSTS.Common.ClosedDate': i.closed },
    },
    relations: [
      ...i.parent ? [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: `https://dev.azure.com/contoso/_apis/wit/workItems/${i.parent}`, attributes: {} }] : [],
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
        return JSON.stringify({ requirementBacklog: { workItemTypes: [{ name: requirement }] }, taskBacklog: { workItemTypes: [{ name: 'Task' }] } });
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

const invokes = (calls: string[][], resource: string) => calls.filter((c) => c[0] === 'devops' && c[c.indexOf('--resource') + 1] === resource);
const shown = (items: Item[]) => items.map((i) => [i.number, i.status, i.parent?.number ?? null]);

const SPRINT: WorkItem[] = [
  { id: 1, type: 'User Story', state: 'Active', title: 'Seek', tags: 'status-shaping; area-api', predecessors: [2, 99] },
  { id: 11, type: 'Task', state: 'Active', parent: 1 },
  { id: 12, type: 'Task', state: 'Closed', parent: 1, closed: '2026-10-20T10:00:00Z' },
  { id: 13, type: 'Task', state: 'Removed', parent: 1 },
  { id: 2, type: 'User Story', state: 'Closed', title: 'Ship', closed: '2026-10-20T09:00:00Z' },
  { id: 3, type: 'User Story', state: 'Removed', title: 'Drop' },
  { id: 4, type: 'Epic', state: 'Active', title: 'Big' },
  { id: 5, type: 'User Story', state: 'New', tags: 'status-review;status-queued' },
  { id: 6, type: 'User Story', state: 'New' },
  { id: 99, type: 'User Story', state: 'Active', title: 'Earlier' },
];

test("a sprint read lists the team's requirement-level items with their Tasks as children, a Completed item as Done, and no Removed item", async () => {
  const az = fakeAz({ items: SPRINT, sprint: [1, 11, 12, 13, 2, 3, 4, 5, 6] });
  const read = await azureSprint(REPO, TEAM, az.run).read();
  assert.equal(read.title, 'Fabrikam Team Sprint 12');
  assert.deepEqual(shown(read.items), [[1, 'Shaping', null], [11, 'List', 1], [12, 'Done', 1], [2, 'Done', null], [5, 'Queued', null], [6, 'List', null]]);
  const seek = read.items[0]!;
  assert.deepEqual({ ...seek, parent: undefined }, {
    id: 'azure:contoso/1', status: 'Shaping', statuses: ['Shaping'], content: 'ticket', number: 1, title: 'Seek',
    url: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/1', repo: REPO, labels: ['area-api'], state: 'open', closedAs: null,
    parent: undefined, subIssues: { total: 2, completed: 1 },
    blockers: [{ number: 2, repo: REPO, state: 'closed' }, { number: 99, repo: REPO, state: 'open' }],
    updatedAt: '2026-10-21T08:00:00Z', closedAt: null, linkedPrs: [], slices: [],
  });
  assert.deepEqual(read.items[1]!.parent, { number: 1, title: 'Seek', url: seek.url, repo: REPO, state: 'open' });
  assert.deepEqual(read.items.find((i) => i.number === 2)!, { ...read.items.find((i) => i.number === 2)!, state: 'closed', closedAs: 'done', closedAt: '2026-10-20T09:00:00Z' });
  // The predecessor outside the sprint is read in a batch of its own, for its state.
  assert.deepEqual(az.batches, [[1, 11, 12, 13, 2, 3, 4, 5, 6], [99]]);
});

test("every az call names the team's organization and project, and every invoke passes --api-version", async () => {
  const az = fakeAz({ items: SPRINT, sprint: [1, 11, 12, 13, 2, 3, 4, 5, 6] });
  await azureSprint(REPO, TEAM, az.run).read();
  for (const call of az.calls) {
    assert.equal(call[call.indexOf('--org') + 1], 'https://dev.azure.com/contoso', call.join(' '));
    if (call[0] === 'devops') {
      assert.ok(call.includes('--api-version') && call[call.indexOf('--api-version') + 1], call.join(' '));
      assert.ok(call.includes('project=Fabrikam Fiber'), call.join(' '));
    } else {
      assert.equal(call[call.indexOf('--project') + 1], 'Fabrikam Fiber', call.join(' '));
      assert.equal(call[call.indexOf('--team') + 1], TEAM, call.join(' '));
    }
  }
  assert.deepEqual(az.calls.find((c) => c[3] === 'list-work-items')!.slice(0, 6), ['boards', 'iteration', 'team', 'list-work-items', '--id', 'it-12']);
});

test("each process's requirement type shows at the top level, and only the team's requirement backlog level's types do", async () => {
  for (const requirement of ['User Story', 'Product Backlog Item', 'Issue', 'Requirement']) {
    const [open, done] = STATES[requirement]!.filter(([, category]) => category === 'InProgress' || category === 'Completed').map(([name]) => name);
    const items: WorkItem[] = [{ id: 1, type: requirement, state: open! }, { id: 2, type: requirement, state: done! },
      { id: 3, type: requirement === 'User Story' ? 'Epic' : 'User Story', state: 'Active' }, { id: 4, type: 'Task', state: 'Active', parent: 1 }];
    const read = await azureSprint(REPO, TEAM, fakeAz({ items, requirement }).run).read();
    assert.deepEqual(shown(read.items), [[1, 'List', null], [4, 'List', 1], [2, 'Done', null]], requirement);
  }
});

test('a read of more than 200 ids reads their fields in batches of at most 200', async () => {
  const items = Array.from({ length: 450 }, (_, i): WorkItem => ({ id: i + 1, type: 'User Story', state: 'New' }));
  const az = fakeAz({ items });
  const read = await azureSprint(REPO, TEAM, az.run).read();
  assert.equal(read.items.length, 450);
  assert.deepEqual(az.batches.map((ids) => ids.length).sort(), [200, 200, 50]);
  const calls = invokes(az.calls, 'workitemsbatch');
  assert.equal(calls.length, 3);
  for (const call of calls) assert.ok(call[call.indexOf('--api-version') + 1], call.join(' '));
});

test('status tags give the statuses and every other tag is a label; an item carrying two refuses a move with the two-status warning', async () => {
  const sprint = azureSprint(REPO, TEAM, fakeAz({ items: SPRINT, sprint: [1, 5, 6] }).run);
  const read = await sprint.read();
  const two = read.items.find((i) => i.number === 5)!;
  assert.deepEqual([two.statuses, two.labels], [['Queued', 'Review'], []]);
  assert.equal(sprint.statusRefusal(two), 'This issue carries Queued and Review. Keep one to move it again.');
});

test('a repository showing Opted-in items hides an item with no status tag', async () => {
  const source = mergeSources([], new Map([[REPO, azureSprint(REPO, TEAM, fakeAz({ items: SPRINT, sprint: [1, 5, 6] }).run)]]), [REPO.toUpperCase()]);
  assert.deepEqual((await source.read()).items.map((i) => i.number), [1, 5]);
});

/** A source for another repository that lists one item. */
const otherRepo: ItemSource = {
  read: async () => ({ title: 'maddec01/lar-apple', items: [{ id: 'I_1', status: 'List', statuses: [], content: 'ticket', number: 1, title: 'Apple', url: null,
    repo: 'maddec01/lar-apple', labels: [], state: 'open', closedAs: null, parent: null, subIssues: { total: 0, completed: 0 }, blockers: [],
    updatedAt: '2026-10-21T08:00:00Z', closedAt: null, linkedPrs: [], slices: [] }] }),
  setStatus: async () => null, statusRefusal: () => null, addLabel: async () => null,
  create: async () => ({ item: null, issueUrl: null, error: null }), setParentStatus: async () => null, abandon: async () => null,
};

test("no current iteration, a logged-out az and a missing azure-devops extension each name their fix, and another repository's items still show", async () => {
  const failing = {
    'no iteration': fakeAz({ items: SPRINT, iterations: [] }),
    'logged out': fakeAz({ items: SPRINT, fail: () => new Error("az boards iteration failed: ERROR: Please run 'az login' to setup account.") }),
    'no extension': fakeAz({ items: SPRINT, fail: (args) => args[0] === 'boards' ? new Error("az boards iteration failed: ERROR: 'boards' is misspelled or not recognized by the system.") : undefined }),
  };
  const expected = {
    'no iteration': { repo: REPO, problem: `Team ${TEAM} has no current iteration in contoso/Fabrikam Fiber. Give the team a sprint whose dates cover today in its project settings, or Edit the repository in Settings › Repositories to name another team.` },
    'logged out': { repo: REPO, problem: 'az is logged out.', fix: 'az login' },
    'no extension': { repo: REPO, problem: 'az has no azure-devops extension.', fix: 'az extension add --name azure-devops' },
  };
  for (const [name, az] of Object.entries(failing)) {
    const source = mergeSources([], new Map([['maddec01/lar-apple', otherRepo], [REPO, azureSprint(REPO, TEAM, az.run)]]));
    const read = await source.read();
    assert.deepEqual(read.items.map((i) => i.repo), ['maddec01/lar-apple'], name);
    assert.deepEqual(read.problems, [expected[name as keyof typeof expected]], name);
  }
});

test('any other az failure fails the read, naming the repository', async () => {
  const az = fakeAz({ items: SPRINT, fail: () => new Error('az boards iteration failed: TF400813: not authorized') });
  const source = mergeSources([], new Map([['maddec01/lar-apple', otherRepo], [REPO, azureSprint(REPO, TEAM, az.run)]]));
  await assert.rejects(source.read(), { message: `${REPO}: az boards iteration failed: TF400813: not authorized` });
});

test('the sprint is read only: every write says so', async () => {
  const sprint = azureSprint(REPO, TEAM, fakeAz({ items: SPRINT, sprint: [6] }).run);
  const [item] = (await sprint.read()).items;
  const refusal = 'The board reads Azure DevOps work items but does not write them yet. Change it in Azure DevOps.';
  assert.equal(sprint.statusRefusal(item!), refusal);
  assert.equal(await sprint.setStatus(item!, 'Queued'), refusal);
  assert.equal(await sprint.addLabel(item!, 'bug'), refusal);
  assert.equal(await sprint.abandon(item!), refusal);
});
