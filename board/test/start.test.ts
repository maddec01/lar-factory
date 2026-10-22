import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawIssue, startBoard } from './server-support.ts';
import { expandHome, loadConfig } from '../src/config.ts';
import type { BoardData } from '../src/model.ts';

type Board = Awaited<ReturnType<typeof startBoard>>;

const draft = { id: 'PVTI_draft', updatedAt: '2026-10-21T09:00:00Z', status: { name: 'Queued' },
  content: { __typename: 'DraftIssue', title: 'Idea', updatedAt: '2026-10-21T09:00:00Z' } };

async function ready(board: Board, count: number): Promise<BoardData> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const data = await board.board() as BoardData;
    if (data.items.length === count) return data;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('The board never read its items');
}

async function start(board: Board, itemId: string, origin = board.url) {
  const { capture } = await board.board() as BoardData;
  return board.post({ session: capture!.session, itemId }, origin, '/api/start');
}

test('expands ~ from HOME so the public config never holds a username', () => {
  assert.equal(expandHome('~/Developer/Mux', '/Users/someone'), '/Users/someone/Developer/Mux');
  assert.equal(expandHome('~', '/Users/someone'), '/Users/someone');
  assert.equal(expandHome('/opt/Mux', '/Users/someone'), '/opt/Mux');
  assert.throws(() => expandHome('~/Developer/Mux', undefined), /HOME/);
  assert.equal(loadConfig().t3Project, '~/Developer/Mux');
});

test('Start begins one mux-work thread in the Mux project and leaves the Status alone', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'Queued')] });
  await ready(board, 1);
  const response = await start(board, 'PVTI_12');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).thread, { threadId: 'thread-1', title: '#12 Issue 12' });
  assert.deepEqual(await board.t3Calls(), [['thread', 'start', `${process.env.HOME}/Developer/Mux`,
    '#12 Issue 12\n$mux-work maddec01/mux-factory#12', '--json']]);
  assert.equal((await board.calls()).filter((args) => args[1] === 'item-edit').length, 0);
});

test('a thread T3 returns untitled takes the first line of the work message as its title', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'Queued')], t3: { untitled: true } });
  await ready(board, 1);
  const response = await start(board, 'PVTI_12');
  assert.deepEqual((await response.json()).thread, { threadId: 'thread-1', title: '#12 Issue 12' });
});

test('a double press, a retry or another page starts no second thread for the item', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'Queued'), rawIssue(13, 'Queued')], t3: { delay: 100 } });
  await ready(board, 2);
  const responses = await Promise.all([start(board, 'PVTI_12'), start(board, 'PVTI_12')]);
  assert.deepEqual(responses.map((r) => r.status), [200, 200]);
  assert.equal((await start(board, 'PVTI_12')).status, 200);
  const thread = { threadId: 'thread-1', title: '#12 Issue 12' };
  assert.deepEqual((await board.board() as BoardData).started, { PVTI_12: thread }, 'a reloaded page sees the thread');
  assert.equal((await start(board, 'PVTI_13')).status, 200, 'another item starts its own thread');
  assert.equal((await board.t3Calls()).length, 2);
});

test('a T3 error is shown and the same request can try again', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'Queued')], t3: { fail: 'down' } });
  await ready(board, 1);
  const failed = await start(board, 'PVTI_12');
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /Is T3 Code running\?/);
  await board.update({ items: [rawIssue(12, 'Queued')] });
  assert.equal((await start(board, 'PVTI_12')).status, 200);
  assert.equal((await board.t3Calls()).length, 2);
});

for (const fail of ['killed', 'garbage']) {
  test(`an unconfirmed start (${fail}) is never retried as a new thread`, async (t) => {
    const board = await startBoard(t, { items: [rawIssue(12, 'Queued')], t3: { fail } });
    await ready(board, 1);
    const first = await start(board, 'PVTI_12');
    assert.equal(first.status, 502);
    assert.equal((await first.json()).uncertain, true);
    await board.update({ items: [rawIssue(12, 'Queued')] });
    assert.equal((await (await start(board, 'PVTI_12')).json()).uncertain, true);
    assert.equal((await board.t3Calls()).length, 1);
  });
}

test('a missing t3 says how to point the board at it', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'Queued')] }, false, false, { T3_PATH: '/nonexistent/t3' });
  await ready(board, 1);
  const response = await start(board, 'PVTI_12');
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /T3_PATH/);
});

test('Start only runs for Queued issues from this board page and session', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(12, 'List'), rawIssue(13, 'Ready'), rawIssue(14, 'Queued'), draft] });
  await ready(board, 4);
  assert.equal((await start(board, 'PVTI_12')).status, 409);
  assert.equal((await start(board, 'PVTI_13')).status, 409);
  assert.match((await (await start(board, 'PVTI_draft')).json()).error, /needs an issue/);
  assert.equal((await start(board, 'PVTI_missing')).status, 404);
  assert.equal((await board.post({ session: (await board.board()).capture.session, itemId: 14 }, board.url, '/api/start')).status, 400);
  const restarted = await board.post({ session: 'old', itemId: 'PVTI_14' }, board.url, '/api/start');
  assert.equal(restarted.status, 409);
  const answer = await restarted.json();
  assert.ok(!answer.uncertain && answer.board.capture.session, 'a stale page gets the new session and can press Start again');
  for (const origin of ['https://evil.example', 'null', '']) assert.equal((await start(board, 'PVTI_14', origin)).status, 403);
  const sample = await startBoard(t, {}, true);
  assert.equal((await start(sample, 'PVTI_sample05')).status, 403);
  assert.deepEqual([...await board.t3Calls(), ...await sample.t3Calls()], []);
});
