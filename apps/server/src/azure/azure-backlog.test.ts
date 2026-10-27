import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Item } from '@lar-factory/shared';
import { mergeSources } from '../items/item-sources.ts';
import { azureBacklog } from './azure-backlog.ts';
import { TEAM_AREA, fakeAz, type WorkItem } from './fake-az.ts';

const REPO = 'contoso/Fabrikam%20Fiber/lar-api';
const TEAM = 'Fabrikam Team';

const shown = (items: Item[]) => items.map((i) => [i.number, i.status, i.parent?.number ?? null]);

const BACKLOG: WorkItem[] = [
  { id: 1, type: 'User Story', state: 'Active', title: 'Seek', tags: 'status-shaping', predecessors: [2, 99] },
  { id: 11, type: 'Task', state: 'Active', parent: 1 },
  { id: 12, type: 'Task', state: 'Closed', parent: 1 },
  { id: 13, type: 'Task', state: 'Removed', parent: 1 },
  { id: 2, type: 'User Story', state: 'New', title: 'Next sprint' },
  { id: 3, type: 'User Story', state: 'New', title: 'No sprint', area: `${TEAM_AREA}\\Search` },
  { id: 4, type: 'User Story', state: 'Closed', title: 'Shipped' },
  { id: 5, type: 'User Story', state: 'Removed', title: 'Dropped' },
  { id: 6, type: 'Epic', state: 'Active', title: 'Big' },
  { id: 7, type: 'User Story', state: 'Active', title: 'Theirs', area: 'Fabrikam Fiber\\Other Team' },
  { id: 99, type: 'User Story', state: 'Closed', title: 'Earlier', area: 'Fabrikam Fiber\\Other Team' },
];

test("a backlog read lists the team's open requirement-level items under its area paths, in any sprint or none", async () => {
  const az = fakeAz({ items: BACKLOG, backlog: [1, 2, 3, 4, 5, 6, 7] });
  const read = await azureBacklog([REPO], TEAM, az.run).read();
  assert.equal(read.title, 'Fabrikam Team backlog');
  // 4 is Completed, 5 Removed, 6 an Epic and 7 under another team's area path.
  assert.deepEqual(shown(read.items), [[1, 'Shaping', null], [11, 'List', 1], [12, 'Done', 1], [2, 'List', null], [3, 'List', null]]);
});

test("Tasks show under their parent, read through its child links, and Predecessors as blockers", async () => {
  const az = fakeAz({ items: BACKLOG, backlog: [1] });
  const [seek, task] = (await azureBacklog([REPO], TEAM, az.run).read()).items;
  assert.deepEqual(seek!.subIssues, { total: 2, completed: 1 });
  assert.deepEqual(seek!.blockers, [{ number: 2, repo: REPO, state: 'open' }, { number: 99, repo: REPO, state: 'closed' }]);
  assert.deepEqual(task!.parent, { number: 1, title: 'Seek', url: seek!.url, repo: REPO, state: 'open' });
  // The Tasks, then the predecessors outside the backlog, each in a batch of their own.
  assert.deepEqual(az.batches, [[1], [11, 12, 13], [2, 99]]);
});

test("an area path the team doesn't include with its children leaves out the items under it", async () => {
  const az = fakeAz({ items: BACKLOG, backlog: [1, 2, 3], areas: [{ value: TEAM_AREA, includeChildren: false }] });
  assert.deepEqual((await azureBacklog([REPO], TEAM, az.run).read()).items.filter((i) => !i.parent).map((i) => i.number), [1, 2]);
});

test("the backlog's calls name the team and its requirement backlog, and every invoke passes --api-version", async () => {
  const az = fakeAz({ items: BACKLOG, backlog: [1, 2] });
  await azureBacklog([REPO], TEAM, az.run).read();
  for (const call of az.calls) {
    assert.equal(call[call.indexOf('--org') + 1], 'https://dev.azure.com/contoso', call.join(' '));
    assert.ok(call.includes('project=Fabrikam Fiber') && call[call.indexOf('--api-version') + 1], call.join(' '));
  }
  const backlog = az.calls.find((c) => c[c.indexOf('--resource') + 1] === 'workitems')!;
  assert.ok(backlog.includes(`team=${TEAM}`) && backlog.includes('backlogId=Microsoft.RequirementCategory'), backlog.join(' '));
  assert.ok(az.calls.find((c) => c[c.indexOf('--resource') + 1] === 'teamfieldvalues')!.includes(`team=${TEAM}`));
});

test('a logged-out az names its fix, and a move on the backlog writes its work item', async () => {
  const out = fakeAz({ items: BACKLOG, fail: () => new Error("az devops invoke failed: ERROR: Please run 'az login' to setup account.") });
  assert.deepEqual((await mergeSources([], new Map([[REPO, azureBacklog([REPO], TEAM, out.run)]])).read()).problems,
    [{ repo: REPO, problem: 'az is logged out.', fix: 'az login' }]);
  const az = fakeAz({ items: BACKLOG, backlog: [2] });
  const backlog = azureBacklog([REPO], TEAM, az.run);
  const [item] = (await backlog.read()).items;
  assert.equal(await backlog.setStatus(item!, 'Queued'), null);
  assert.deepEqual(az.patches.map((p) => p.id), [2]);
});
