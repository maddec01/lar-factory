import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
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
