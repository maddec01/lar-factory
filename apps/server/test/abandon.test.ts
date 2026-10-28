import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { onboarded, startableEnv, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import type { BoardData } from '@lar-factory/shared';


const abandon = (board: Board, itemId: string, origin = board.url) => board.postSession({ itemId }, '/api/abandon', origin);

const has = (data: BoardData, id: string) => data.items.some((i) => i.id === id);
const writes = async (board: Board) => (await board.calls()).filter((args) => args[1] === 'close' || args[1] === 'item-delete');

async function reads(board: Board, n: number): Promise<void> {
  const count = async () => (await board.calls()).filter((args) => args[1] === 'graphql').length;
  const target = await count() + n;
  while (await count() < target) await new Promise((r) => setTimeout(r, 20));
}

test('Abandon closes the issue as not planned on GitHub and the board drops it at once', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List'), boardIssue(13, 'List')] });
  await until(board, (d) => d.items.length === 2);
  const response = await abandon(board, 'I_12');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.error, null);
  assert.ok(!has(result.board, 'I_12'));
  assert.ok(has(result.board, 'I_13'));
  assert.deepEqual(await writes(board), [['issue', 'close', '12', '-R', 'maddec01/lar-factory', '--reason', 'not planned']]);
});

test('a failed close keeps the item and reports the error', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')], fail: 'abandon' });
  await until(board, (d) => d.items.length === 1);
  const response = await abandon(board, 'I_12');
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.match(result.error, /Could not abandon #12\. .*write access/);
  assert.ok(has(result.board, 'I_12'));
  assert.ok(has(await board.board(), 'I_12'));
});

test('an abandoned item does not come back while GitHub still reports it', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')] }, false, true);
  await until(board, (d) => d.items.length === 1);
  assert.equal((await abandon(board, 'I_12')).status, 200);
  await reads(board, 5);
  const data = await board.board() as BoardData;
  assert.ok(!has(data, 'I_12'));
});

test('an item this board just created does not come back after Abandon', async (t) => {
  const board = await startBoard(t, { items: [] }, false, true);
  await onboarded(board);
  const created = await board.postSession({ requestId: '00000000-0000-4000-8000-000000000001',
    draft: { repo: 'maddec01/lar-server', kind: 'bug', title: 'Throwaway', description: '', labels: [] } }, '/api/items');
  assert.equal(created.status, 200);
  // GitHub has not reported the new item yet, so only the board's own copy holds it.
  assert.equal((await abandon(board, 'I_900001')).status, 200);
  await reads(board, 2);
  assert.ok(!has(await board.board(), 'I_900001'));
  await board.update({ items: [boardIssue(900001, 'List', 'maddec01/lar-server')] });
  await reads(board, 3);
  assert.ok(!has(await board.board(), 'I_900001'));
});

test('Abandon only removes List and Queued items', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'Shaping')] });
  await until(board, (d) => d.items.length === 1);
  const refused = await abandon(board, 'I_12');
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'Only List and Queued issues and drafts can be abandoned; this one is an issue in Shaping.');
  assert.equal((await abandon(board, 'I_missing')).status, 404);
  assert.equal((await board.post({ itemId: 'I_12' }, board.url, '/api/abandon')).status, 409, 'needs this board session');
  assert.deepEqual(await writes(board), []);
});

test('Abandon rejects requests from other pages and sample mode', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')] });
  await until(board, (d) => d.items.length === 1);
  for (const origin of ['https://evil.example', 'null', '']) assert.equal((await abandon(board, 'I_12', origin)).status, 403);
  assert.deepEqual(await writes(board), []);
  const sample = await startBoard(t, {}, true);
  assert.equal((await abandon(sample, 'I_sample01')).status, 403);
  assert.equal((await sample.calls()).length, 0);
});

const startItem = (board: Board, itemId: string) => board.postSession({ itemId }, '/api/start');

test('Abandon is refused while a Start is in flight, uncertain or done for the item', async (t) => {
  const refused = 'Start is running or has run for this item. Check its T3 thread before abandoning it.';
  const board = await startBoard(t, { items: [boardIssue(12, 'Queued')], t3: { delay: 300 } }, false, false, startableEnv(t));
  await until(board, (d) => d.items.length === 1);
  const starting = startItem(board, 'I_12');
  await new Promise((r) => setTimeout(r, 100));
  const inFlight = await abandon(board, 'I_12');
  assert.equal(inFlight.status, 409);
  assert.equal((await inFlight.json()).error, refused);
  assert.equal((await starting).status, 200);
  assert.equal((await abandon(board, 'I_12')).status, 409, 'done');
  const unsure = await startBoard(t, { items: [boardIssue(12, 'Queued')], t3: { fail: 'garbage' } }, false, false, startableEnv(t));
  await until(unsure, (d) => d.items.length === 1);
  assert.equal((await startItem(unsure, 'I_12')).status, 502);
  assert.equal((await abandon(unsure, 'I_12')).status, 409, 'uncertain');
  assert.deepEqual([...await writes(board), ...await writes(unsure)], []);
});

test('Abandon is refused while Back to List is pending for the item', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'Queued')], writeDelay: 300 });
  await until(board, (d) => d.items.length === 1);
  const moving = board.post({ itemId: 'I_12' }, board.url, '/api/back-to-list');
  await new Promise((r) => setTimeout(r, 100));
  const refused = await abandon(board, 'I_12');
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'This item is being moved, so it can\'t be abandoned.');
  assert.equal((await moving).status, 200);
  assert.deepEqual(await writes(board), []);
});
