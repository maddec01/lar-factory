import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import { isBuild, openBlockers } from '@lar-factory/shared';
import { azureBoard } from './azure-board.ts';
import { fakeAz } from './fake-az.ts';

const REPO = 'contoso/Fabrikam%20Fiber/lar-api';

test('the Azure board combines backlog and sprint once, keeping sprint completion and Task counts', async () => {
  const az = fakeAz({ items: [
    { id: 1, type: 'User Story', state: 'New' },
    { id: 2, type: 'User Story', state: 'Active' },
    { id: 3, type: 'User Story', state: 'Closed' },
    { id: 4, type: 'User Story', state: 'Closed' },
    { id: 5, type: 'Task', state: 'New', parent: 2 },
    { id: 6, type: 'User Story', state: 'Active', area: 'Another team' },
  ], backlog: [1, 2, 3, 4, 6], sprint: [2, 3, 5, 6] });
  const source = azureBoard([REPO], 'Fabrikam Team', az.run);
  const read = await source.read();
  assert.deepEqual(read.items.map((i) => i.number).sort(), [1, 2, 3, 6]);
  assert.equal(read.items.find((i) => i.number === 3)?.status, 'Done');
  assert.deepEqual((await source.readSome!(read.items)).map((i) => i.number).sort(), [1, 2, 3, 6]);
});

test('the Azure board still reads the backlog when no sprint is current', async () => {
  const az = fakeAz({ items: [{ id: 1, type: 'User Story', state: 'New' }], iterations: [] });
  assert.deepEqual((await azureBoard([REPO], 'Fabrikam Team', az.run).read()).items.map((i) => i.number), [1]);
});

test('the Azure board reports sprint read failures instead of silently dropping its items', async () => {
  const az = fakeAz({ items: [], fail: (args) => args.includes('list-work-items') ? new Error('Sprint unavailable') : undefined });
  await assert.rejects(azureBoard([REPO], 'Fabrikam Team', az.run).read(), /Sprint unavailable/);
});


test('combined reads keep backlog priority and count sprint children only for sprint parents', async () => {
  const az = fakeAz({ items: [
    { id: 1, type: 'User Story', state: 'Active' },
    { id: 11, type: 'Task', state: 'New', parent: 1 },
    { id: 12, type: 'Task', state: 'New', parent: 1 },
    { id: 2, type: 'User Story', state: 'New' },
    { id: 21, type: 'Task', state: 'Closed', parent: 2 },
  ], backlog: [2, 1], sprint: [1, 11] });
  const source = azureBoard([REPO], 'Fabrikam Team', az.run);
  const read = await source.read();
  assert.deepEqual(read.items.map((i) => [i.number, i.sourceOrder, i.subIssues]), [
    [2, 0, { total: 1, completed: 1 }], [1, 1, { total: 1, completed: 0 }],
  ]);
  assert.deepEqual((await source.readSome!(read.items)).map((i) => i.subIssues), read.items.map((i) => i.subIssues));
});

test('a concept exposes its Ready child build outside the sprint, while plain team Tasks stay hidden', async () => {
  const az = fakeAz({ items: [
    { id: 1, type: 'User Story', state: 'Active', tags: 'concept; status-shaping' },
    { id: 11, type: 'Task', state: 'New', parent: 1, tags: 'build; status-ready' },
    { id: 12, type: 'Task', state: 'New', parent: 1, title: 'Implement' },
    { id: 111, type: 'Task', state: 'New', parent: 11, title: 'A slice', tags: 'active' },
  ], backlog: [1], sprint: [] });
  const source = azureBoard([REPO], 'Fabrikam Team', az.run);
  const read = await source.read();
  assert.deepEqual(read.items.map((i) => i.number), [1, 11]);
  const build = read.items[1]!;
  assert.equal(build.status, 'Ready');
  assert.equal(isBuild(build), true);
  assert.deepEqual(openBlockers(build), []);
  assert.equal(build.parent?.number, 1);
  assert.deepEqual(build.subIssues, { total: 1, completed: 0 });
  assert.deepEqual((await source.readSome!([build])).map((i) => [i.number, i.status, i.parent?.number]), [[11, 'Ready', 1]]);
});

test('factory tags expose Tasks, while kind, repository and slice tags alone keep team Tasks hidden', async () => {
  const tags = ['build', 'decision-grill', 'decision-prototype', 'decision-research', 'decision-task', 'concept', 'status-queued',
    'feature', 'repo-lar-api', 'active', 'blocked', 'status-unknown'];
  const az = fakeAz({ items: tags.map((tag, i) => ({ id: i + 1, type: 'Task', state: 'New', tags: tag })), backlog: [] });
  assert.deepEqual((await azureBoard([REPO], 'Fabrikam Team', az.run).read()).items.map((i) => i.number), [1, 2, 3, 4, 5, 6, 7]);
});

test('factory Tasks retain sprint completion, Removed filtering, blockers and repository placement', async () => {
  const az = fakeAz({ items: [
    { id: 1, type: 'User Story', state: 'Active', tags: 'concept' },
    { id: 11, type: 'Task', state: 'Closed', parent: 1, tags: 'decision-research' },
    { id: 12, type: 'Task', state: 'Removed', parent: 1, tags: 'build' },
    { id: 13, type: 'Task', state: 'New', parent: 1, tags: 'build; repo-other' },
    { id: 14, type: 'Task', state: 'New', parent: 1, tags: 'build; status-ready', predecessors: [11] },
  ], backlog: [1], sprint: [1, 11, 12, 13, 14] });
  const items = (await azureBoard([REPO], 'Fabrikam Team', az.run).read()).items;
  assert.deepEqual(items.map((i) => [i.number, i.status]), [[1, 'List'], [11, 'Done'], [14, 'Ready']]);
  assert.deepEqual(items[2]!.blockers, [{ number: 11, repo: REPO, state: 'closed' }]);
});
