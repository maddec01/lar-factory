import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawIssue, startBoard } from './server-support.ts';
import { statsDb } from './stats-db.ts';
import { randomUUID } from 'node:crypto';

const draft = { repo: 'maddec01/mux-factory', kind: 'feature', title: 'Capture an item', description: '', labels: [] };

test('writes reject foreign and missing origins before touching GitHub', async (t) => {
  const board = await startBoard(t);
  for (const origin of ['https://evil.example', 'null', '']) {
    const response = await board.post({}, origin);
    assert.equal(response.status, 403);
  }
  const calls = await board.calls();
  assert.equal(calls.filter((args) => args[0] !== 'api' || args[1] !== 'graphql').length, 0);
});

test('a completed submission is immediately visible and duplicate delivery reuses it', async (t) => {
  const board = await startBoard(t, { createDelay: 80, readDelay: 700 });
  const initial = await board.board();
  const body = { session: initial.capture.session, requestId: randomUUID(), draft };
  const responses = await Promise.all([board.post(body), board.post(body)]);
  const result = await responses[0]!.json();
  assert.equal(responses[0]!.status, 200);
  assert.equal(responses[1]!.status, 200);
  assert.equal(result.item.status, 'List');
  assert.equal(result.board.items[0].title, 'Capture an item');
  assert.equal((await board.board()).items[0].title, 'Capture an item');
  await new Promise((r) => setTimeout(r, 850));
  assert.equal((await board.board()).items[0].title, 'Capture an item', 'older refresh cannot erase the created item');
  assert.equal((await board.post(body)).status, 200, 'lost HTTP response can be delivered again');
  const calls = await board.calls();
  assert.equal(calls.filter((args) => args[0] === 'api' && args[1] === '--method').length, 1);
});

test('partial HTTP success links the issue and retry finishes project assignment once', async (t) => {
  const board = await startBoard(t, { fail: 'status' });
  const initial = await board.board();
  const body = { session: initial.capture.session, requestId: randomUUID(), draft };
  const first = await board.post(body);
  assert.equal(first.status, 502);
  const partial = await first.json();
  assert.equal(partial.issueUrl, 'https://github.com/maddec01/mux-factory/issues/900001');
  assert.match(partial.error, /List status/);
  assert.equal(partial.board.items.length, 0);
  assert.equal((await board.post({ ...body, draft: { ...draft, title: 'Another item' } })).status, 409);
  await board.update({});
  const retry = await board.post(body);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).item.title, 'Capture an item');
  const calls = await board.calls();
  assert.equal(calls.filter((args) => args[0] === 'api' && args[1] === '--method').length, 1);
  assert.equal(calls.filter((args) => args[1] === 'item-add').length, 1);
});

test('HTTP validation rejects malformed, oversized and mismatched drafts without a GitHub write', async (t) => {
  const board = await startBoard(t);
  const initial = await board.board();
  const body = { session: initial.capture.session, requestId: randomUUID(), draft };
  for (const changed of [{ title: '  ' }, { labels: ['app: music'] }, { repo: 'other/repo' }, { kind: 'concept' }, { description: 42 }]) {
    const response = await board.post({ ...body, draft: { ...draft, ...changed } });
    assert.equal(response.status, 422);
    assert.equal(typeof (await response.json()).error, 'string');
  }
  assert.equal((await board.post({ ...body, session: 'old-board-session' })).status, 409);
  assert.equal((await board.post({ ...body, draft: { ...draft, description: 'x'.repeat(100_001) } })).status, 413);
  assert.equal((await fetch(`${board.url}/api/items`, { method: 'POST', headers: { Origin: board.url, 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(`${board.url}/api/items`, { method: 'POST', headers: { Origin: board.url }, body: '{}' })).status, 415);
  assert.equal((await board.calls()).filter((args) => args[0] === 'api' && args[1] === '--method').length, 0);
});

test('sample mode never writes through the local GitHub login', async (t) => {
  const board = await startBoard(t, {}, true);
  assert.equal((await board.post({})).status, 403);
  assert.equal((await board.board()).capture.enabled, false);
  assert.equal((await board.calls()).length, 0);
});

test('successful refreshes eventually remove a created item whose project membership is absent', async (t) => {
  const board = await startBoard(t, {}, false, true);
  const initial = await board.board();
  const response = await board.post({ session: initial.capture.session, requestId: randomUUID(), draft });
  assert.equal((await response.json()).board.items.length, 1, 'creation appears immediately');
  // GitHub keeps returning no membership, as when the item was removed before reconciliation.
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!(await board.board()).items.length) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal((await board.board()).items.length, 0, 'a temporary overlay cannot outlive repeated authoritative reads');
});

/** The board's items once its first read lands. */
async function readItems(board: Awaited<ReturnType<typeof startBoard>>): Promise<{ number: number; stats?: unknown }[]> {
  for (let attempt = 0; attempt < 80; attempt++) {
    const { items } = await board.board();
    if (items.length) return items;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('The board never read its items');
}

test('each refresh attaches item stats from T3 Code\'s database, and a missing database leaves them out', async (t) => {
  const db = statsDb(t, [{ id: 'build', messages: ['Build maddec01/mux-factory#12'], turns: [
    { id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z',
      usage: { inputTokens: 500, cachedInputTokens: 400, outputTokens: 20, usageStatus: 'complete' } },
  ] }]);
  const items = await readItems(await startBoard(t, { items: [rawIssue(12, 'Done'), rawIssue(13, 'Review')] }, false, false, { T3_STATE_DB: db }));
  assert.deepEqual(items.find((i) => i.number === 12)?.stats, { agentMs: 30 * 60_000, tokens: { input: 500, cached: 400, output: 20, lowerBound: false } });
  assert.equal(items.find((i) => i.number === 13)?.stats, undefined);
  const [without] = await readItems(await startBoard(t, { items: [rawIssue(12, 'Done')] }));
  assert.equal(without?.stats, undefined);
});
