import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawIssue, startBoard } from './server-support.ts';
import type { BoardData } from '../src/model.ts';

type Board = Awaited<ReturnType<typeof startBoard>>;

const draft = { id: 'PVTI_draft', updatedAt: '2026-10-21T09:00:00Z', status: { name: 'List' },
  content: { __typename: 'DraftIssue', title: 'Idea', updatedAt: '2026-10-21T09:00:00Z' } };

async function until(board: Board, check: (data: BoardData) => boolean): Promise<BoardData> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const data = await board.board() as BoardData;
    if (check(data)) return data;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('The board never reached the expected state');
}

async function abandon(board: Board, itemId: string, origin = board.url) {
  const { capture } = await board.board() as BoardData;
  return board.post({ session: capture!.session, itemId }, origin, '/api/abandon');
}

const has = (data: BoardData, id: string) => data.items.some((i) => i.id === id);
const deletes = async (board: Board) => (await board.calls()).filter((args) => args[1] === 'delete' || args[1] === 'item-delete');

async function reads(board: Board, n: number): Promise<void> {
  const count = async () => (await board.calls()).filter((args) => args[1] === 'graphql').length;
  const target = await count() + n;
  while (await count() < target) await new Promise((r) => setTimeout(r, 20));
}

test('Abandon deletes the issue on GitHub and the board drops it at once', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'List'), rawIssue(13, 'List')] });
  await until(board, (d) => d.items.length === 2);
  const response = await abandon(board, 'PVTI_12');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.error, null);
  assert.ok(!has(result.board, 'PVTI_12'));
  assert.ok(has(result.board, 'PVTI_13'));
  assert.deepEqual(await deletes(board), [['issue', 'delete', '12', '-R', 'maddec01/mux-factory', '--yes']]);
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
  const board = await startBoard(t, { items: [rawIssue(12, 'List')], fail: 'delete' });
  await until(board, (d) => d.items.length === 1);
  const response = await abandon(board, 'PVTI_12');
  assert.equal(response.status, 502);
  const result = await response.json();
  assert.match(result.error, /Could not delete #12\. .*admin rights/);
  assert.ok(has(result.board, 'PVTI_12'));
  assert.ok(has(await board.board(), 'PVTI_12'));
});

test('an abandoned item does not come back while GitHub still reports it', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'List'), draft] }, false, true);
  await until(board, (d) => d.items.length === 2);
  assert.equal((await abandon(board, 'PVTI_12')).status, 200);
  assert.equal((await abandon(board, 'PVTI_draft')).status, 200);
  await reads(board, 5);
  const data = await board.board() as BoardData;
  assert.ok(!has(data, 'PVTI_12') && !has(data, 'PVTI_draft'));
});

test('an item this board just created does not come back after Abandon', async (t) => {
  const board = await startBoard(t, { items: [] }, false, true);
  const { capture } = await board.board() as BoardData;
  const created = await board.post({ session: capture!.session, requestId: '00000000-0000-4000-8000-000000000001',
    draft: { repo: 'maddec01/mux-server', kind: 'bug', title: 'Throwaway', description: '', labels: [] } });
  assert.equal(created.status, 200);
  // GitHub has not reported the new item yet, so only the board's own copy holds it.
  assert.equal((await abandon(board, 'PVTI_900001')).status, 200);
  await reads(board, 2);
  assert.ok(!has(await board.board(), 'PVTI_900001'));
  await board.update({ items: [rawIssue(900001, 'List', 'maddec01/mux-server')] });
  await reads(board, 3);
  assert.ok(!has(await board.board(), 'PVTI_900001'));
});

test('Abandon only removes List items', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'Queued')] });
  await until(board, (d) => d.items.length === 1);
  assert.equal((await abandon(board, 'PVTI_12')).status, 409);
  assert.equal((await abandon(board, 'PVTI_missing')).status, 404);
  assert.equal((await board.post({ itemId: 'PVTI_12' }, board.url, '/api/abandon')).status, 409, 'needs this board session');
  assert.deepEqual(await deletes(board), []);
});

test('Abandon rejects requests from other pages and sample mode', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'List')] });
  await until(board, (d) => d.items.length === 1);
  for (const origin of ['https://evil.example', 'null', '']) assert.equal((await abandon(board, 'PVTI_12', origin)).status, 403);
  assert.deepEqual(await deletes(board), []);
  const sample = await startBoard(t, {}, true);
  assert.equal((await abandon(sample, 'PVTI_sample01')).status, 403);
  assert.equal((await sample.calls()).length, 0);
});
