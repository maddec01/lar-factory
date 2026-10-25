import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { draftItem, startableEnv, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';
import { projectIssue } from '@lar-factory/shared/test/raw-items';
import type { BoardData } from '@lar-factory/shared';

const draft = draftItem('List');

const abandon = (board: Board, itemId: string, origin = board.url) => board.postSession({ itemId }, '/api/abandon', origin);

const has = (data: BoardData, id: string) => data.items.some((i) => i.id === id);
const deletes = async (board: Board) => (await board.calls()).filter((args) => args[1] === 'delete' || args[1] === 'item-delete');

async function reads(board: Board, n: number): Promise<void> {
  const count = async () => (await board.calls()).filter((args) => args[1] === 'graphql').length;
  const target = await count() + n;
  while (await count() < target) await new Promise((r) => setTimeout(r, 20));
}

test('Abandon deletes the issue on GitHub and the board drops it at once', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(12, 'List'), projectIssue(13, 'List')] });
  await until(board, (d) => d.items.length === 2);
  const response = await abandon(board, 'PVTI_12');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.error, null);
  assert.ok(!has(result.board, 'PVTI_12'));
  assert.ok(has(result.board, 'PVTI_13'));
  assert.deepEqual(await deletes(board), [['issue', 'delete', '12', '-R', 'maddec01/lar-factory', '--yes']]);
});

test('Abandon on a draft removes it from the project', async (t) => {
  const board = await startBoard(t, { items: [draft] });
  await until(board, (d) => d.items.length === 1);
  const response = await abandon(board, 'PVTI_draft');
  assert.equal(response.status, 200);
  assert.ok(!has((await response.json()).board, 'PVTI_draft'));
  assert.deepEqual(await deletes(board), [['project', 'item-delete', '1', '--owner', 'maddec01', '--id', 'PVTI_draft']]);
});

test('a failed delete keeps the item and reports the error', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(12, 'List')], fail: 'delete' });
  await until(board, (d) => d.items.length === 1);
  const response = await abandon(board, 'PVTI_12');
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.match(result.error, /Could not delete #12\. .*admin rights/);
  assert.ok(has(result.board, 'PVTI_12'));
  assert.ok(has(await board.board(), 'PVTI_12'));
});

test('an abandoned item does not come back while GitHub still reports it', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(12, 'List'), draft] }, false, true);
  await until(board, (d) => d.items.length === 2);
  assert.equal((await abandon(board, 'PVTI_12')).status, 200);
  assert.equal((await abandon(board, 'PVTI_draft')).status, 200);
  await reads(board, 5);
  const data = await board.board() as BoardData;
  assert.ok(!has(data, 'PVTI_12') && !has(data, 'PVTI_draft'));
});

test('an item this board just created does not come back after Abandon', async (t) => {
  const board = await startBoard(t, { items: [] }, false, true);
  const created = await board.postSession({ requestId: '00000000-0000-4000-8000-000000000001',
    draft: { repo: 'maddec01/lar-server', kind: 'bug', title: 'Throwaway', description: '', labels: [] } }, '/api/items');
  assert.equal(created.status, 200);
  // GitHub has not reported the new item yet, so only the board's own copy holds it.
  assert.equal((await abandon(board, 'PVTI_900001')).status, 200);
  await reads(board, 2);
  assert.ok(!has(await board.board(), 'PVTI_900001'));
  await board.update({ items: [projectIssue(900001, 'List', 'maddec01/lar-server')] });
  await reads(board, 3);
  assert.ok(!has(await board.board(), 'PVTI_900001'));
});

test('Abandon deletes a Queued issue and removes a Queued draft', async (t) => {
  const queuedDraft = draftItem('Queued');
  const board = await startBoard(t, { items: [projectIssue(12, 'Queued'), queuedDraft] });
  await until(board, (d) => d.items.length === 2);
  assert.equal((await abandon(board, 'PVTI_12')).status, 200);
  const response = await abandon(board, 'PVTI_draft');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).board.items, []);
  assert.deepEqual(await deletes(board), [
    ['issue', 'delete', '12', '-R', 'maddec01/lar-factory', '--yes'],
    ['project', 'item-delete', '1', '--owner', 'maddec01', '--id', 'PVTI_draft'],
  ]);
});

test('Abandon only removes List and Queued items', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(12, 'Shaping')] });
  await until(board, (d) => d.items.length === 1);
  const refused = await abandon(board, 'PVTI_12');
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'Only List and Queued issues and drafts can be abandoned; this one is an issue in Shaping.');
  assert.equal((await abandon(board, 'PVTI_missing')).status, 404);
  assert.equal((await board.post({ itemId: 'PVTI_12' }, board.url, '/api/abandon')).status, 409, 'needs this board session');
  assert.deepEqual(await deletes(board), []);
});

test('Abandon rejects requests from other pages and sample mode', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(12, 'List')] });
  await until(board, (d) => d.items.length === 1);
  for (const origin of ['https://evil.example', 'null', '']) assert.equal((await abandon(board, 'PVTI_12', origin)).status, 403);
  assert.deepEqual(await deletes(board), []);
  const sample = await startBoard(t, {}, true);
  assert.equal((await abandon(sample, 'PVTI_sample01')).status, 403);
  assert.equal((await sample.calls()).length, 0);
});

const startItem = (board: Board, itemId: string) => board.postSession({ itemId }, '/api/start');

test('Abandon is refused while a Start is in flight, uncertain or done for the item', async (t) => {
  const refused = 'Start is running or has run for this item. Check its T3 thread before abandoning it.';
  const board = await startBoard(t, { items: [projectIssue(12, 'Queued')], t3: { delay: 300 } }, false, false, startableEnv(t));
  await until(board, (d) => d.items.length === 1);
  const starting = startItem(board, 'PVTI_12');
  await new Promise((r) => setTimeout(r, 100));
  const inFlight = await abandon(board, 'PVTI_12');
  assert.equal(inFlight.status, 409);
  assert.equal((await inFlight.json()).error, refused);
  assert.equal((await starting).status, 200);
  assert.equal((await abandon(board, 'PVTI_12')).status, 409, 'done');
  const unsure = await startBoard(t, { items: [projectIssue(12, 'Queued')], t3: { fail: 'garbage' } }, false, false, startableEnv(t));
  await until(unsure, (d) => d.items.length === 1);
  assert.equal((await startItem(unsure, 'PVTI_12')).status, 502);
  assert.equal((await abandon(unsure, 'PVTI_12')).status, 409, 'uncertain');
  assert.deepEqual([...await deletes(board), ...await deletes(unsure)], []);
});

test('Abandon is refused while Back to List is pending for the item', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(12, 'Queued')], writeDelay: 300 });
  await until(board, (d) => d.items.length === 1);
  const moving = board.post({ itemId: 'PVTI_12' }, board.url, '/api/back-to-list');
  await new Promise((r) => setTimeout(r, 100));
  const refused = await abandon(board, 'PVTI_12');
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'This item is being moved, so it can\'t be abandoned.');
  assert.equal((await moving).status, 200);
  assert.deepEqual(await deletes(board), []);
});
