import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { openWorkRecords, workRecordsPath } from '@lar-factory/work-records';
import { startableEnv, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import type { BoardData, Status } from '@lar-factory/shared';

const statusOf = (data: BoardData, id: string) => data.items.find((i) => i.id === id)?.status;
const queue = (board: Board, itemId: string, origin = board.url) => board.post({ itemId }, origin, '/api/queue');
const backToList = (board: Board, itemId: string, origin = board.url) => board.post({ itemId }, origin, '/api/back-to-list');
/** The gh calls that changed an issue: a move writes none. */
const issueEdits = async (board: Board) => (await board.calls()).filter((args) => args[0] === 'issue' && args[1] === 'edit');

/** The Status the board's work-record database holds for `workId`, read as a thread would. */
async function recordedStatus(board: Board, workId: string): Promise<Status> {
  const records = await openWorkRecords(workRecordsPath(board.dataDir));
  try { return records.read(workId).status; } finally { records.close(); }
}

test('Queue moves the work record to Queued, shows it at once and writes nothing to GitHub', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')] });
  await until(board, (d) => d.items.length === 1);
  const id = board.id(12);
  const response = await queue(board, id);
  assert.equal(response.status, 200);
  assert.equal(statusOf((await response.json()).board, id), 'Queued');
  assert.equal(statusOf(await board.board(), id), 'Queued');
  assert.equal(await recordedStatus(board, id), 'Queued');
  assert.deepEqual(await issueEdits(board), []);
});

test("refreshes keep the record's Queued though GitHub's labels still say List", async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')] }, false, true);
  await until(board, (d) => d.items.length === 1);
  const id = board.id(12);
  assert.equal((await queue(board, id)).status, 200);
  const reads = async () => (await board.calls()).filter((args) => args[1] === 'graphql' && args.some((a) => a.includes('states: [OPEN]'))).length;
  const target = await reads() + 4;
  while (await reads() < target) await new Promise((r) => setTimeout(r, 20));
  assert.equal(statusOf(await board.board(), id), 'Queued');
});

test("a ticket edit never changes the record's Status", async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')] }, false, true);
  await until(board, (d) => d.items.length === 1);
  const id = board.id(12);
  await board.update({ items: [boardIssue(12, 'Ready', 'maddec01/lar-factory', ['bug'])] });
  await until(board, (d) => d.items.some((i) => i.labels.includes('bug')));
  assert.equal(statusOf(await board.board(), id), 'List');
});

test('Queue only moves List items and is a no-op for an item already Queued', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'Queued'), boardIssue(13, 'Ready')] });
  await until(board, (d) => d.items.length === 2);
  assert.equal((await queue(board, board.id(12))).status, 200);
  assert.equal((await queue(board, board.id(13))).status, 409);
  assert.equal((await queue(board, 'missing')).status, 404);
  assert.equal((await board.post({ itemId: 7 }, board.url, '/api/queue')).status, 400);
  assert.equal(await recordedStatus(board, board.id(13)), 'Ready');
});

test('a move on a record a thread changed since the board read it is refused, and the board shows the record as it is', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')] });
  await until(board, (d) => d.items.length === 1);
  const id = board.id(12);
  const records = await openWorkRecords(workRecordsPath(board.dataDir));
  try { records.update(id, records.read(id).revision, { kind: 'bug' }); } finally { records.close(); }
  const response = await queue(board, id);
  assert.equal(response.status, 409);
  const body = await response.json() as { error: string; board: BoardData };
  assert.match(body.error, /read it again/);
  assert.equal(body.board.items.find((i) => i.id === id)?.kind, 'bug');
  assert.equal(await recordedStatus(board, id), 'List');
});

test('Queue and Back to List reject requests from other pages and sample mode', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')] });
  await until(board, (d) => d.items.length === 1);
  for (const origin of ['https://evil.example', 'null', '']) {
    assert.equal((await queue(board, board.id(12), origin)).status, 403);
    assert.equal((await backToList(board, board.id(12), origin)).status, 403);
  }
  assert.equal(await recordedStatus(board, board.id(12)), 'List');
  const sample = await startBoard(t, {}, true);
  assert.equal((await queue(sample, 'I_sample01')).status, 403);
  const response = await backToList(sample, 'I_sample01');
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, 'Moving items back to List is disabled in sample mode.');
  assert.equal((await sample.calls()).length, 0);
});

test('Back to List moves the work record to List and writes nothing to GitHub', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'Queued'), boardIssue(13, 'Ready')] });
  await until(board, (d) => d.items.length === 2);
  const id = board.id(12);
  const response = await backToList(board, id);
  assert.equal(response.status, 200);
  assert.equal(statusOf((await response.json()).board, id), 'List');
  assert.equal(await recordedStatus(board, id), 'List');
  assert.equal((await backToList(board, id)).status, 200, 'an item already in List is a no-op');
  const refused = await backToList(board, board.id(13));
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'Only Queued items can be moved back to List; this one is in Ready.');
  assert.deepEqual(await issueEdits(board), []);
});

const startItem = (board: Board, itemId: string) => board.postSession({ itemId }, '/api/start');

test('Back to List is refused while a Start is in flight, uncertain or done for the item', async (t) => {
  const refused = 'Start is running or has run for this item. Check its T3 thread before moving it back to List.';
  const board = await startBoard(t, { items: [boardIssue(12, 'Queued')], t3: { delay: 300 } }, false, false, startableEnv(t));
  await until(board, (d) => d.items.length === 1);
  const id = board.id(12);
  const starting = startItem(board, id);
  await new Promise((r) => setTimeout(r, 100));
  const inFlight = await backToList(board, id);
  assert.equal(inFlight.status, 409);
  assert.equal((await inFlight.json()).error, refused);
  assert.equal((await starting).status, 200);
  assert.equal((await backToList(board, id)).status, 409, 'done');
  const unsure = await startBoard(t, { items: [boardIssue(12, 'Queued')], t3: { fail: 'killed' } }, false, false, startableEnv(t));
  await until(unsure, (d) => d.items.length === 1);
  assert.equal((await startItem(unsure, unsure.id(12))).status, 502);
  assert.equal((await backToList(unsure, unsure.id(12))).status, 409, 'uncertain');
  assert.equal(await recordedStatus(board, id), 'Queued');
});

test('Back to List is refused while Abandon is pending for the item', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'Queued')], writeDelay: 300 });
  await until(board, (d) => d.items.length === 1);
  const id = board.id(12);
  const abandoning = board.postSession({ itemId: id }, '/api/abandon');
  await new Promise((r) => setTimeout(r, 100));
  const refused = await backToList(board, id);
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'This item is being abandoned, so it can\'t move.');
  assert.equal((await abandoning).status, 200);
  assert.deepEqual(await issueEdits(board), []);
});
