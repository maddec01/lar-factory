import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawIssue, startBoard } from './server-support.ts';
import { assistant, claudeHome, statsDb, t3Settings } from './stats-db.ts';
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

test('each refresh attaches item stats from T3 Code\'s database and Claude transcripts, and a missing database leaves them out', async (t) => {
  const db = statsDb(t, [{ id: 'build', messages: ['Build maddec01/mux-factory#12'],
    sessions: [{ session: 'session-1', instance: 'claudeAgent_personal' }], turns: [
      { id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' },
    ] }]);
  const home = claudeHome(t, { 'session-1': { main: [assistant('m0', 1, 2, 3, 4)], subagents: { a1: [assistant('m1', 5, 0, 300, 9)] } } });
  const items = await readItems(await startBoard(t, { items: [rawIssue(12, 'Done'), rawIssue(13, 'Review')] }, false, false,
    { T3_STATE_DB: db, T3_SETTINGS: t3Settings(t, { claudeAgent_personal: home }) }));
  assert.deepEqual(items.find((i) => i.number === 12)?.stats, { agentMs: 30 * 60_000, tokens: 10 + 314 });
  assert.equal(items.find((i) => i.number === 13)?.stats, undefined);
  const [without] = await readItems(await startBoard(t, { items: [rawIssue(12, 'Done')] }));
  assert.equal(without?.stats, undefined);
});

test('refreshes keep a stats block in open linked PRs, edit only when it changes, and never in sample mode', async (t) => {
  const db = statsDb(t, [{ id: 'build', messages: ['Build maddec01/mux-factory#12'], turns: [
    { id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' },
  ] }]);
  const pr = (number: number, state: string) => ({ number, url: `https://github.com/maddec01/mux-factory/pull/${number}`,
    state, isDraft: false, body: `PR ${number}` });
  const withPrs = (number: number, prs: object[]) => {
    const raw = rawIssue(number, 'Review');
    return { ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: prs } } };
  };
  const items = [withPrs(12, [pr(40, 'OPEN'), pr(41, 'MERGED')]), withPrs(13, [pr(42, 'OPEN')])];
  const board = await startBoard(t, { items }, false, true, { T3_STATE_DB: db });
  const edits = async () => (await board.calls()).filter((args) => args[2] === 'PATCH');
  for (let attempt = 0; attempt < 80 && !(await edits()).length; attempt++) await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => setTimeout(r, 400));
  const made = await edits();
  assert.equal(made.length, 1, 'later refreshes see the block is current and leave the PR alone');
  assert.equal(made[0]![3], 'repos/maddec01/mux-factory/pulls/40', 'merged PRs and items without stats are left alone');
  assert.equal(made[0]![5], 'body=PR 40\n\n<!-- mux-stats -->\n**Item stats** (kept current by the Mux board): agent time 30m · 0 tokens\n<!-- /mux-stats -->');

  const failing = await startBoard(t, { items, fail: 'pr-edit' }, false, false, { T3_STATE_DB: db });
  assert.equal((await readItems(failing)).length, 2, 'a failed edit leaves the board working');

  const sample = await startBoard(t, {}, true, true, { T3_STATE_DB: db });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual((await sample.calls()).filter((args) => args[2] === 'PATCH'), []);
});

test('a merged item shows the figures in its merged PR\'s block, not live ones, and live ones without a block', async (t) => {
  const turns = [{ id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' }];
  const db = statsDb(t, [{ id: 'a', messages: ['Build maddec01/mux-factory#12'], turns },
    { id: 'b', messages: ['Build maddec01/mux-factory#13'], turns: [{ ...turns[0]!, id: 'u' }] }]);
  const block = '<!-- mux-stats -->\n**Item stats** (kept current by the Mux board): agent time 2h 15m · 12.4M tokens · $41\n<!-- /mux-stats -->';
  const merged = (number: number, prNumber: number, body: string) => {
    const raw = rawIssue(number, 'Done');
    return { ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: [
      { number: prNumber, url: `https://github.com/maddec01/mux-factory/pull/${prNumber}`, state: 'MERGED', isDraft: false, body },
    ] } } };
  };
  const board = await startBoard(t, { items: [merged(12, 40, `PR 40\n\n${block}`), merged(13, 41, 'PR 41'), merged(14, 42, `PR 42\n\n${block}`)] },
    false, true, { T3_STATE_DB: db });
  const items = await readItems(board);
  const frozen = { agentMs: 135 * 60_000, tokens: 12_400_000, costUsd: 41, frozen: true };
  assert.deepEqual(items.find((i) => i.number === 12)?.stats, frozen, 'the block wins over live stats');
  assert.deepEqual(items.find((i) => i.number === 13)?.stats, { agentMs: 30 * 60_000, tokens: 0 }, 'no block: live stats');
  assert.deepEqual(items.find((i) => i.number === 14)?.stats, frozen, 'no live stats at all');
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual((await board.calls()).filter((args) => args[2] === 'PATCH'), [], 'merged PRs are never edited');
});

test('an item with a merged and an open linked PR shows live stats, and the open PR\'s block tracks them', async (t) => {
  const db = statsDb(t, [{ id: 'a', messages: ['Build maddec01/mux-factory#12'], turns: [
    { id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' },
  ] }]);
  const frozenBlock = '<!-- mux-stats -->\n**Item stats** (kept current by the Mux board): agent time 2h 15m · 12.4M tokens · $41\n<!-- /mux-stats -->';
  const url = (number: number) => `https://github.com/maddec01/mux-factory/pull/${number}`;
  const raw = rawIssue(12, 'Review');
  const items = [{ ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: [
    { number: 40, url: url(40), state: 'MERGED', isDraft: false, body: `PR 40\n\n${frozenBlock}`, mergedAt: '2026-10-19T00:00:00Z' },
    { number: 41, url: url(41), state: 'OPEN', isDraft: false, body: 'PR 41', mergedAt: null },
  ] } } }];
  const board = await startBoard(t, { items }, false, true, { T3_STATE_DB: db });
  const [item] = await readItems(board);
  assert.deepEqual(item?.stats, { agentMs: 30 * 60_000, tokens: 0 });
  const edits = async () => (await board.calls()).filter((args) => args[2] === 'PATCH');
  for (let attempt = 0; attempt < 80 && !(await edits()).length; attempt++) await new Promise((r) => setTimeout(r, 25));
  const [edit] = await edits();
  assert.equal(edit?.[3], 'repos/maddec01/mux-factory/pulls/41');
  assert.equal(edit?.[5], 'body=PR 41\n\n<!-- mux-stats -->\n**Item stats** (kept current by the Mux board): agent time 30m · 0 tokens\n<!-- /mux-stats -->');
});

test('before an edit the board reads the PR again, keeps edits made since its read, and skips a block already current', async (t) => {
  const db = statsDb(t, [{ id: 'build', messages: ['Build maddec01/mux-factory#12'], turns: [
    { id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' },
  ] }]);
  const block = '<!-- mux-stats -->\n**Item stats** (kept current by the Mux board): agent time 30m · 0 tokens\n<!-- /mux-stats -->';
  const url = (number: number) => `https://github.com/maddec01/mux-factory/pull/${number}`;
  const pr = (number: number, body: string) => ({ number, url: url(number), state: 'OPEN', isDraft: false, body });
  const raw = rawIssue(12, 'Review');
  const items = [{ ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: [
    // Edits go in order, so once PR 40's lands, PR 43 was read and left alone.
    pr(43, 'PR 43'), pr(44, `PR 44\n\n${block}`), pr(40, 'PR 40'),
  ] } } }];
  const liveBodies = { [url(40)]: 'PR 40, edited by Pedro', [url(43)]: `PR 43\n\n${block}` };
  const board = await startBoard(t, { items, liveBodies }, false, false, { T3_STATE_DB: db });
  const prCalls = async () => (await board.calls()).filter((args) => args[0] === 'api' && args[1] !== 'graphql');
  for (let attempt = 0; attempt < 80 && !(await prCalls()).some((args) => args[2] === 'PATCH'); attempt++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  const calls = await prCalls();
  assert.deepEqual(calls.filter((args) => args[2] !== 'PATCH').map((args) => args[1]),
    ['repos/maddec01/mux-factory/pulls/43', 'repos/maddec01/mux-factory/pulls/40'], 'only PRs the board thinks need an edit are read');
  assert.deepEqual(calls.filter((args) => args[2] === 'PATCH').map((args) => [args[3], args[5]]),
    [['repos/maddec01/mux-factory/pulls/40', `body=PR 40, edited by Pedro\n\n${block}`]]);
});

test('PR edits run beside the refreshes without holding them up, and never two syncs at once', async (t) => {
  const db = statsDb(t, [{ id: 'build', messages: ['Build maddec01/mux-factory#12'], turns: [
    { id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' },
  ] }]);
  const raw = rawIssue(12, 'Review');
  const items = [{ ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: [
    { number: 40, url: 'https://github.com/maddec01/mux-factory/pull/40', state: 'OPEN', isDraft: false, body: 'PR 40' },
  ] } } }];
  // Refreshes run every 100 ms; the edit takes 1.5 s.
  const board = await startBoard(t, { items, prEditDelay: 1500 }, false, true, { T3_STATE_DB: db });
  const prCalls = async () => (await board.calls()).filter((args) => args[1]?.startsWith('repos/') || args[2] === 'PATCH');
  for (let attempt = 0; attempt < 80 && !(await prCalls()).some((args) => args[2] === 'PATCH'); attempt++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  type Board = { fetchedAt: string; items: { linkedPrs: { body?: string }[] }[] };
  const first = (await board.board()) as Board;
  let later = first;
  for (let attempt = 0; attempt < 40 && later.fetchedAt === first.fetchedAt; attempt++) {
    await new Promise((r) => setTimeout(r, 25));
    later = (await board.board()) as Board;
  }
  assert.notEqual(later.fetchedAt, first.fetchedAt, 'the board refreshed while the edit was under way');
  assert.equal(later.items[0]?.linkedPrs[0]?.body, 'PR 40', 'the edit had not landed yet');
  await new Promise((r) => setTimeout(r, 1700));
  assert.deepEqual((await prCalls()).map((args) => args[2] === 'PATCH' ? 'PATCH' : 'read'), ['read', 'PATCH'],
    'refreshes during the edit started no second sync');
});
