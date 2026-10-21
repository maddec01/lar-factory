import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawIssue, startBoard } from './server-support.ts';
import type { BoardData } from '../src/model.ts';

type Board = Awaited<ReturnType<typeof startBoard>>;

async function until(board: Board, check: (data: BoardData) => boolean): Promise<BoardData> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const data = await board.board() as BoardData;
    if (check(data)) return data;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('The board never reached the expected state');
}

const statusOf = (data: BoardData, id: string) => data.items.find((i) => i.id === id)?.status;
const queue = (board: Board, itemId: string, origin = board.url) => board.post({ itemId }, origin, '/api/queue');

test('Queue sets Queued on GitHub and the board shows it at once', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'List')] });
  await until(board, (d) => d.items.length === 1);
  const response = await queue(board, 'PVTI_12');
  assert.equal(response.status, 200);
  assert.equal(statusOf((await response.json()).board, 'PVTI_12'), 'Queued');
  assert.equal(statusOf(await board.board(), 'PVTI_12'), 'Queued');
  const edits = (await board.calls()).filter((args) => args[1] === 'item-edit');
  assert.deepEqual(edits, [['project', 'item-edit', '--project-id', 'PVT_1', '--id', 'PVTI_12',
    '--field-id', 'FIELD_1', '--single-select-option-id', 'QUEUED_1']]);
});

test('refreshes keep the item in Queued until GitHub reports the change', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'List')], readDelay: 50, ignoreEdits: true }, false, true);
  await until(board, (d) => d.items.length === 1);
  const reads = async () => (await board.calls()).filter((args) => args[1] === 'graphql').length;
  const waitForReads = async (n: number) => { const target = await reads() + n; while (await reads() < target) await new Promise((r) => setTimeout(r, 20)); };
  assert.equal((await queue(board, 'PVTI_12')).status, 200);
  // Two reads that finish after the edit still report List.
  await waitForReads(2);
  assert.equal(statusOf(await board.board(), 'PVTI_12'), 'Queued');
  await board.update({ items: [rawIssue(12, 'Queued')], readDelay: 50 });
  await waitForReads(5);
  assert.equal(statusOf(await board.board(), 'PVTI_12'), 'Queued');
});

test('after three reads that still say List, the board trusts GitHub', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'List')], ignoreEdits: true }, false, true);
  await until(board, (d) => d.items.length === 1);
  assert.equal((await queue(board, 'PVTI_12')).status, 200);
  await until(board, (d) => statusOf(d, 'PVTI_12') === 'List');
});

test('Queue only moves List items and is a no-op for an item already Queued', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'Queued'), rawIssue(13, 'Ready')] });
  await until(board, (d) => d.items.length === 2);
  assert.equal((await queue(board, 'PVTI_12')).status, 200);
  assert.equal((await queue(board, 'PVTI_13')).status, 409);
  assert.equal((await queue(board, 'PVTI_missing')).status, 404);
  assert.equal((await board.post({ itemId: 7 }, board.url, '/api/queue')).status, 400);
  assert.equal((await board.calls()).filter((args) => args[1] === 'item-edit').length, 0);
});

test('a failed status write leaves the item in List and reports the error', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'List')], fail: 'status' });
  await until(board, (d) => d.items.length === 1);
  const response = await queue(board, 'PVTI_12');
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /GitHub temporarily unavailable/);
  assert.equal(statusOf(await board.board(), 'PVTI_12'), 'List');
});

test('Queue rejects requests from other pages and sample mode', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'List')] });
  await until(board, (d) => d.items.length === 1);
  for (const origin of ['https://evil.example', 'null', '']) assert.equal((await queue(board, 'PVTI_12', origin)).status, 403);
  assert.equal((await board.calls()).filter((args) => args[1] === 'item-edit').length, 0);
  const sample = await startBoard(t, {}, true);
  assert.equal((await queue(sample, 'PVTI_sample01')).status, 403);
  assert.equal((await sample.calls()).length, 0);
});
