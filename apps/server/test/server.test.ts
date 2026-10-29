import { test, type TestContext } from 'vite-plus/test';
import { createServer } from 'node:net';
import { get } from 'node:http';
import assert from 'node:assert/strict';
import { onboarded, readsRepositoryConfig, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { assistant, claudeHome, statsDb, t3Settings } from './stats-db.ts';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { itemTotal } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

const draft = { repo: 'maddec01/lar-factory', kind: 'feature', title: 'Capture an item', description: '', labels: [] };

test('writes reject foreign and missing origins before touching GitHub', async (t) => {
  const board = await startBoard(t);
  for (const origin of ['https://evil.example', 'null', '']) {
    const response = await board.post({}, origin);
    assert.equal(response.status, 403);
  }
  const calls = await board.calls();
  // Reads and the startup gh probe touch nothing; the startup read's offers look for open PRs.
  const writes = calls.filter((args) => !(args[0] === 'api' && args[1] === 'graphql') && !(args[0] === 'api' && args[1] === '-i') && args[0] !== '--version' && args[0] !== 'auth' && !readsRepositoryConfig(args)
    && !(args[0] === 'pr' && args[1] === 'list'));
  assert.equal(writes.length, 0);
});

test('a completed submission is immediately visible and duplicate delivery reuses it', async (t) => {
  const board = await startBoard(t, { createDelay: 80, readDelay: 700 });
  await onboarded(board);
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

test('the page holds its first paint for its one script, served from the board, so it never shows empty', async (t) => {
  const board = await startBoard(t, {}, true);
  const response = await fetch(`${board.url}/`);
  assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self';/);
  const scripts = [...(await response.text()).matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag);
  assert.equal(scripts.length, 2);
  assert.match(scripts[0]!, /^<script type="module" blocking="render" crossorigin src="\/assets\/index-[\w-]+\.js">$/);
  assert.equal(scripts[1], '<script id="board-data" type="application/json">');
});

test('sample mode never writes through the local GitHub login', async (t) => {
  const board = await startBoard(t, {}, true);
  assert.equal((await board.post({})).status, 403);
  assert.equal((await board.board()).capture.enabled, false);
  assert.equal((await board.calls()).length, 0);
});

test('successful refreshes eventually remove a created item whose issue is absent', async (t) => {
  const board = await startBoard(t, {}, false, true);
  await onboarded(board);
  const initial = await board.board();
  const response = await board.post({ session: initial.capture.session, requestId: randomUUID(), draft });
  assert.equal((await response.json()).board.items.length, 1, 'creation appears immediately');
  // GitHub keeps returning no issue, as when the item was removed before reconciliation.
  for (let attempt = 0; attempt < 40; attempt++) {
    if (!(await board.board()).items.length) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal((await board.board()).items.length, 0, 'a temporary overlay cannot outlive repeated authoritative reads');
});

const rawBuild = (number: number, status: string) => boardIssue(number, status, undefined, ['build']);

/** The board's items once its first read lands. */
const readItems = async (board: Board): Promise<Item[]> => (await until(board, (d) => d.items.length > 0)).items;
/** The items once the board shows live stats, which wait for T3's transcripts to be read after the first read. */
const readLiveStats = async (board: Board): Promise<Item[]> =>
  (await until(board, (d) => d.items.some((i) => typeof i.stats === 'object' && !i.stats.frozen))).items;

test("a refresh finds build sub-issues, active and blocked slices with issue searches, not the board query's labels", async (t) => {
  const repository = { nameWithOwner: 'maddec01/lar-factory' };
  const ref = (number: number) => ({ number, title: `Issue ${number}`, url: `https://github.com/maddec01/lar-factory/issues/${number}`,
    state: 'OPEN', stateReason: null, repository });
  const parent = rawBuild(13, 'In progress');
  const items = [{ ...parent, content: { ...parent.content, subIssues: { nodes: [ref(12), ref(15), ref(16)] } } }, rawBuild(12, 'In progress'), boardIssue(15, 'In progress')];
  const board = await startBoard(t, { items, builds: [{ number: 12, repository }], active: [{ number: 15, repository }, { number: 16, repository }],
    blocked: [{ number: 16, repository }] });
  const read = await readItems(board);
  assert.deepEqual(read.map((i) => i.number), [13, 12], 'the build sub-issue stays a board item; the slice does not');
  const [built] = read;
  assert.deepEqual(built?.subIssues, { total: 1, completed: 0 });
  assert.deepEqual(built?.slices.map((s) => [s.number, s.progress]), [[15, 'active'], [16, 'blocked']]);
});

test('a build sub-issue on the board stays a board item while the issue search still misses its new label', async (t) => {
  const repository = { nameWithOwner: 'maddec01/lar-factory' };
  const ref = { number: 12, title: 'Issue 12', url: 'https://github.com/maddec01/lar-factory/issues/12', state: 'OPEN', stateReason: null, repository };
  const parent = rawBuild(13, 'In progress');
  const items = [{ ...parent, content: { ...parent.content, subIssues: { nodes: [ref] } } }, rawBuild(12, 'In progress')];
  const read = await readItems(await startBoard(t, { items, builds: [] }));
  assert.deepEqual(read.map((i) => i.number), [13, 12]);
  assert.deepEqual(read[0]?.subIssues, { total: 1, completed: 0 });
});

test('each refresh attaches item stats from T3 Code\'s database and Claude transcripts, and a missing database leaves them out', async (t) => {
  const db = statsDb(t, [{ id: 'build', messages: ['Build maddec01/lar-factory#12'],
    sessions: [{ session: 'session-1', instance: 'claudeAgent_personal' }], turns: [
      { id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' },
    ] }]);
  const home = claudeHome(t, { 'session-1': { main: [assistant('m0', 1, 2, 3, 4)], subagents: { a1: [assistant('m1', 5, 0, 300, 9)] } } });
  const items = await readLiveStats(await startBoard(t, { items: [boardIssue(12, 'Done'), boardIssue(13, 'Review')] }, false, false,
    { T3_STATE_DB: db, T3_SETTINGS: t3Settings(t, { claudeAgent_personal: home }) }));
  assert.deepEqual(items.find((i) => i.number === 12)?.stats, { agentMs: 30 * 60_000, wallMs: 30 * 60_000, tokens: 10 + 314 });
  assert.equal(items.find((i) => i.number === 13)?.stats, undefined);
  const [without] = await readItems(await startBoard(t, { items: [boardIssue(12, 'Done')] }));
  assert.equal(without?.stats, undefined);
});

test('each refresh attaches item threads and T3\'s environment id, and leaves them out without T3\'s files', async (t) => {
  const db = statsDb(t, [{ id: 'build', title: 'Build: owner accounts', messages: ['Build maddec01/lar-factory#12'],
    turns: [{ id: 't', startedAt: '2026-10-20T09:00:00Z' }] }]);
  const environment = join(mkdtempSync(join(tmpdir(), 'lar-t3-env-')), 'environment-id');
  t.onTestFinished(() => rmSync(join(environment, '..'), { recursive: true, force: true }));
  writeFileSync(environment, 'env-1\n');
  const board = await startBoard(t, { items: [boardIssue(12, 'In progress'), boardIssue(13, 'Review')] }, false, false,
    { T3_STATE_DB: db, T3_ENVIRONMENT_ID: environment });
  const data = await until(board, (d) => d.items.length > 0 && d.firstRead?.settled === true);
  assert.equal(data.t3EnvironmentId, 'env-1');
  assert.deepEqual(data.items.find((i) => i.number === 12)?.threads,
    [{ id: 'build', title: 'Build: owner accounts', state: 'running', updated: '2026-10-20T09:00:00.000Z' }]);
  assert.equal(data.items.find((i) => i.number === 13)?.threads, undefined);
  const without = await until(await startBoard(t, { items: [boardIssue(12, 'In progress')] }), (d) => d.items.length > 0);
  assert.equal(without.t3EnvironmentId, undefined);
  assert.equal(without.items[0]?.threads, undefined);
});

test('refreshes keep a stats block in open linked PRs, edit only when it changes, and never in sample mode', async (t) => {
  const db = statsDb(t, [{ id: 'build', messages: ['Build maddec01/lar-factory#12'], turns: [
    { id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' },
  ] }]);
  const pr = (number: number, state: string) => ({ number, url: `https://github.com/maddec01/lar-factory/pull/${number}`,
    state, isDraft: false, body: `PR ${number}` });
  const withPrs = (number: number, prs: object[]) => {
    const raw = rawBuild(number, 'Review');
    return { ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: prs } } };
  };
  const items = [withPrs(12, [pr(40, 'OPEN'), pr(41, 'MERGED')]), withPrs(13, [pr(42, 'OPEN')])];
  const board = await startBoard(t, { items }, false, true, { T3_STATE_DB: db });
  const edits = async () => (await board.calls()).filter((args) => args[2] === 'PATCH');
  for (let attempt = 0; attempt < 80 && !(await edits()).length; attempt++) await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => setTimeout(r, 400));
  const made = await edits();
  assert.equal(made.length, 1, 'later refreshes see the block is current and leave the PR alone');
  assert.equal(made[0]![3], 'repos/maddec01/lar-factory/pulls/40', 'merged PRs and items without stats are left alone');
  assert.equal(made[0]![5], 'body=PR 40\n\n<!-- lar-stats -->\n**Item stats** (kept current by the lar board): Σ 30m · wall 30m · 0\n<!-- lar-stats-data {"agentMs":1800000,"wallMs":1800000,"tokens":0} -->\n<!-- /lar-stats -->');

  const failing = await startBoard(t, { items, fail: 'pr-edit' }, false, false, { T3_STATE_DB: db });
  assert.equal((await readItems(failing)).length, 2, 'a failed edit leaves the board working');

  const sample = await startBoard(t, {}, true, true, { T3_STATE_DB: db });
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual((await sample.calls()).filter((args) => args[2] === 'PATCH'), []);
});

test('a merged item retains its PR figures and adds fresh stats without lowering known work', async (t) => {
  const turns = [{ id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' }];
  const db = statsDb(t, [{ id: 'a', messages: ['Build maddec01/lar-factory#12'], turns },
    { id: 'b', messages: ['Build maddec01/lar-factory#13'], turns: [{ ...turns[0]!, id: 'u' }] }]);
  const block = '<!-- lar-stats -->\n**Item stats** (kept current by the lar board): agent time 2h 15m · 12.4M tokens · $41\n<!-- /lar-stats -->';
  const merged = (number: number, prNumber: number, body: string) => {
    const raw = rawBuild(number, 'Done');
    return { ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: [
      { number: prNumber, url: `https://github.com/maddec01/lar-factory/pull/${prNumber}`, state: 'MERGED', isDraft: false, body },
    ] } } };
  };
  const board = await startBoard(t, { items: [merged(12, 40, `PR 40\n\n${block}`), merged(13, 41, 'PR 41'), merged(14, 42, `PR 42\n\n${block}`)] },
    false, true, { T3_STATE_DB: db });
  const items = await readLiveStats(board);
  const frozen = { agentMs: 135 * 60_000, tokens: 12_400_000, costUsd: 41, frozen: true };
  assert.deepEqual(items.find((i) => i.number === 12)?.stats, { ...frozen, wallMs: 30 * 60_000 }, 'retain known figures and add the fresh wall time');
  assert.deepEqual(items.find((i) => i.number === 13)?.stats, { agentMs: 30 * 60_000, wallMs: 30 * 60_000, tokens: 0 }, 'no block: live stats');
  assert.deepEqual(items.find((i) => i.number === 14)?.stats, frozen, 'no live stats at all');
  await until(board, (d) => d.items.find((i) => i.number === 12)?.linkedPrs.some((pr) => pr.body?.includes('<!-- lar-stats-data ')) === true);
  assert.deepEqual((await board.calls()).filter((args) => args[2] === 'PATCH').map((args) => args[3]),
    ['repos/maddec01/lar-factory/pulls/40'], 'only the PR with fresher stats gets a final block');
});

test('an item with a merged and an open linked PR shows live stats, and the open PR\'s block tracks them', async (t) => {
  const db = statsDb(t, [{ id: 'a', messages: ['Build maddec01/lar-factory#12'], turns: [
    { id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' },
  ] }]);
  const frozenBlock = '<!-- lar-stats -->\n**Item stats** (kept current by the lar board): agent time 2h 15m · 12.4M tokens · $41\n<!-- /lar-stats -->';
  const url = (number: number) => `https://github.com/maddec01/lar-factory/pull/${number}`;
  const raw = rawBuild(12, 'Review');
  const items = [{ ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: [
    { number: 40, url: url(40), state: 'MERGED', isDraft: false, body: `PR 40\n\n${frozenBlock}`, mergedAt: '2026-10-19T00:00:00Z' },
    { number: 41, url: url(41), state: 'OPEN', isDraft: false, body: 'PR 41', mergedAt: null },
  ] } } }];
  const board = await startBoard(t, { items }, false, true, { T3_STATE_DB: db });
  const [item] = await readLiveStats(board);
  assert.deepEqual(item?.stats, { agentMs: 30 * 60_000, wallMs: 30 * 60_000, tokens: 0 });
  const edits = async () => (await board.calls()).filter((args) => args[2] === 'PATCH');
  for (let attempt = 0; attempt < 80 && !(await edits()).length; attempt++) await new Promise((r) => setTimeout(r, 25));
  const [edit] = await edits();
  assert.equal(edit?.[3], 'repos/maddec01/lar-factory/pulls/41');
  assert.equal(edit?.[5], 'body=PR 41\n\n<!-- lar-stats -->\n**Item stats** (kept current by the lar board): Σ 30m · wall 30m · 0\n<!-- lar-stats-data {"agentMs":1800000,"wallMs":1800000,"tokens":0} -->\n<!-- /lar-stats -->');
});

test('an issue that isn\'t a build shows live figures and writes no block, even linked to a build\'s PRs', async (t) => {
  const turns = [{ id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' }];
  const db = statsDb(t, [{ id: 'a', messages: ['Build maddec01/lar-factory#12'], turns },
    { id: 'b', messages: ['/lar-work maddec01/lar-factory#13'], turns: [{ ...turns[0]!, id: 'u' }] }]);
  const block = '<!-- lar-stats -->\n**Item stats** (kept current by the lar board): agent time 2h 15m · 12.4M tokens · $41\n<!-- /lar-stats -->';
  const prs = { nodes: [
    { number: 40, url: 'https://github.com/maddec01/lar-factory/pull/40', state: 'MERGED', isDraft: false, body: `PR 40\n\n${block}` },
    { number: 41, url: 'https://github.com/maddec01/lar-factory/pull/41', state: 'OPEN', isDraft: false, body: 'PR 41' },
  ] };
  const build = rawBuild(12, 'Done');
  const parent = boardIssue(13, 'In progress');
  const items = [{ ...parent, content: { ...parent.content, closedByPullRequestsReferences: prs } },
    { ...build, content: { ...build.content, closedByPullRequestsReferences: { nodes: [prs.nodes[0]] } } }];
  const board = await startBoard(t, { items }, false, true, { T3_STATE_DB: db });
  const read = await readLiveStats(board);
  assert.deepEqual(read.find((i) => i.number === 13)?.stats, { agentMs: 30 * 60_000, wallMs: 30 * 60_000, tokens: 0 });
  assert.equal((read.find((i) => i.number === 12)?.stats as { frozen?: boolean } | undefined)?.frozen, true);
  await until(board, (d) => d.items.find((i) => i.number === 12)?.linkedPrs.some((pr) => pr.body?.includes('<!-- lar-stats-data ')) === true);
  assert.deepEqual((await board.calls()).filter((args) => args[2] === 'PATCH').map((args) => args[3]),
    ['repos/maddec01/lar-factory/pulls/40'], 'only the build refreshes its final wall time');
});

test("only a build's linked PRs have their body and merge time read, once each, and an item that isn't a build's never", async (t) => {
  const url = (number: number) => `https://github.com/maddec01/lar-factory/pull/${number}`;
  const pr = (number: number) => ({ number, url: url(number), state: 'OPEN', isDraft: false, body: `PR ${number}` });
  const linked = (raw: ReturnType<typeof rawBuild>, numbers: number[]) =>
    ({ ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: numbers.map(pr) } } });
  const items = [linked(boardIssue(13, 'In progress'), [40, 41]), linked(rawBuild(12, 'Review'), [40]), linked(rawBuild(14, 'Review'), [40, 42])];
  const board = await startBoard(t, { items });
  await readItems(board);
  const first = (await board.calls()).find((args) => args.some((a) => a.includes('... on PullRequest { id body mergedAt }')));
  const asked = first?.filter((a) => a.startsWith('ids[]='));
  assert.deepEqual(asked, [`ids[]=${url(40)}`, `ids[]=${url(42)}`]);
});

test('a parent with two builds merged at different times: each build keeps its own frozen figures, the parent writes no block, its total counts all once', async (t) => {
  const turns = [{ id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' }];
  // The parent's own thread is live; the builds' threads are gone from T3 Code, as after transcript deletion.
  const db = statsDb(t, [{ id: 'p', messages: ['$lar-work maddec01/lar-factory#13'], turns }]);
  const block = (figures: string) => `<!-- lar-stats -->\n**Item stats** (kept current by the lar board): ${figures}\n<!-- /lar-stats -->`;
  const pr = (number: number, mergedAt: string, body: string) => ({ number, url: `https://github.com/maddec01/lar-factory/pull/${number}`,
    state: 'MERGED', isDraft: false, body, mergedAt });
  const first = pr(40, '2026-10-18T10:00:00Z', `PR 40\n\n${block('Σ 1h 0m · wall 40m · 2M · $10')}`);
  const last = pr(41, '2026-10-20T10:00:00Z', `PR 41\n\n${block('Σ 2h 0m · wall 1h 0m · 3M · $20')}`);
  const parentRef = { number: 13, title: 'Issue 13', url: 'https://github.com/maddec01/lar-factory/issues/13', state: 'OPEN',
    repository: { nameWithOwner: 'maddec01/lar-factory' } };
  const build = (number: number, linked: object) => {
    const raw = rawBuild(number, 'Done');
    return { ...raw, content: { ...raw.content, state: 'CLOSED', closedAt: new Date(Date.now() - 60_000).toISOString(), updatedAt: new Date(Date.now() - 60_000).toISOString(), parent: parentRef,
      closedByPullRequestsReferences: { nodes: [linked] } } };
  };
  const parent = boardIssue(13, 'In progress');
  // The last build's PR also closes the parent.
  const items = [{ ...parent, content: { ...parent.content, subIssuesSummary: { total: 2, completed: 2 },
    closedByPullRequestsReferences: { nodes: [last] } } }, build(12, first), build(14, last)];
  const check = async (board: Awaited<ReturnType<typeof startBoard>>) => {
    const read = await readLiveStats(board);
    const of = (number: number) => read.find((i) => i.number === number)!;
    assert.deepEqual(of(12).stats, { agentMs: 60 * 60_000, wallMs: 40 * 60_000, tokens: 2_000_000, costUsd: 10, frozen: true });
    assert.deepEqual(of(14).stats, { agentMs: 120 * 60_000, wallMs: 60 * 60_000, tokens: 3_000_000, costUsd: 20, frozen: true });
    assert.deepEqual(of(13).stats, { agentMs: 30 * 60_000, wallMs: 30 * 60_000, tokens: 0 }, 'the parent keeps live own figures');
    assert.deepEqual(itemTotal(of(13), read), { agentMs: 210 * 60_000, wallMs: 130 * 60_000, tokens: 5_000_000, costUsd: 30 });
  };
  const board = await startBoard(t, { items }, false, true, { T3_STATE_DB: db });
  await check(board);
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual((await board.calls()).filter((args) => args[2] === 'PATCH'), [], 'merged PRs are never edited, and the parent writes no block');
  await check(await startBoard(t, { items }, false, false, { T3_STATE_DB: db }));
});

test('before an edit the board reads the PR again, keeps edits made since its read, and skips a block already current', async (t) => {
  const db = statsDb(t, [{ id: 'build', messages: ['Build maddec01/lar-factory#12'], turns: [
    { id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' },
  ] }]);
  const block = '<!-- lar-stats -->\n**Item stats** (kept current by the lar board): Σ 30m · wall 30m · 0\n<!-- lar-stats-data {"agentMs":1800000,"wallMs":1800000,"tokens":0} -->\n<!-- /lar-stats -->';
  const url = (number: number) => `https://github.com/maddec01/lar-factory/pull/${number}`;
  const pr = (number: number, body: string) => ({ number, url: url(number), state: 'OPEN', isDraft: false, body });
  const raw = rawBuild(12, 'Review');
  const items = [{ ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: [
    // Edits go in order, so once PR 40's lands, PR 43 was read and left alone.
    pr(43, 'PR 43'), pr(44, `PR 44\n\n${block}`), pr(40, 'PR 40'),
  ] } } }];
  const liveBodies = { [url(40)]: 'PR 40, edited by hand', [url(43)]: `PR 43\n\n${block}` };
  const board = await startBoard(t, { items, liveBodies }, false, false, { T3_STATE_DB: db });
  const prCalls = async () => (await board.calls()).filter((args) => args[0] === 'api' && args[1] !== 'graphql' && !readsRepositoryConfig(args));
  for (let attempt = 0; attempt < 80 && !(await prCalls()).some((args) => args[2] === 'PATCH'); attempt++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  const calls = await prCalls();
  assert.deepEqual(calls.filter((args) => args[2] !== 'PATCH').map((args) => args[1]),
    ['repos/maddec01/lar-factory/pulls/43', 'repos/maddec01/lar-factory/pulls/40'], 'only PRs the board thinks need an edit are read');
  assert.deepEqual(calls.filter((args) => args[2] === 'PATCH').map((args) => [args[3], args[5]]),
    [['repos/maddec01/lar-factory/pulls/40', `body=PR 40, edited by hand\n\n${block}`]]);
});

test('PR edits run beside the refreshes without holding them up, and never two syncs at once', async (t) => {
  const db = statsDb(t, [{ id: 'build', messages: ['Build maddec01/lar-factory#12'], turns: [
    { id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' },
  ] }]);
  const raw = rawBuild(12, 'Review');
  const items = [{ ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: [
    { number: 40, url: 'https://github.com/maddec01/lar-factory/pull/40', state: 'OPEN', isDraft: false, body: 'PR 40' },
  ] } } }];
  // Refreshes run every 100 ms; the edit takes 1.5 s.
  const board = await startBoard(t, { items, prEditDelay: 1500 }, false, true, { T3_STATE_DB: db });
  const prCalls = async () => (await board.calls()).filter((args) => (args[1]?.startsWith('repos/') && !readsRepositoryConfig(args)) || args[2] === 'PATCH');
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

/** Holds `port` for the test; a port something else already holds is taken all the same. */
async function hold(t: TestContext, port: number): Promise<number> {
  const server = createServer();
  const bound = await new Promise<number>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) => error.code === 'EADDRINUSE' && port !== 0 ? resolve(port) : reject(error));
    server.listen(port, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
  });
  t.onTestFinished(() => new Promise<void>((resolve) => server.listening ? server.close(() => resolve()) : resolve()));
  return bound;
}

test('without BOARD_PORT the board skips a taken 4317, binds the next free port and logs it', async (t) => {
  await hold(t, 4317);
  const board = await startBoard(t, {}, true, false, { BOARD_PORT: '' });
  const port = Number(new URL(board.url).port);
  assert.ok(port >= 4318 && port <= 4416, board.url);
  assert.match(board.logs(), new RegExp(`board on http://127\\.0\\.0\\.1:${port}`));
  assert.equal((await fetch(`${board.url}/api/board`)).status, 200, 'the host check accepts the bound port');
  // fetch always sends the URL's host, so ask through http to name the old port.
  const misdirected = await new Promise<number | undefined>((resolve, reject) => {
    get(`${board.url}/api/board`, { headers: { Host: '127.0.0.1:4317' } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
  assert.equal(misdirected, 421);
});

test('a BOARD_PORT that isn\'t a port exits with a log line, not a stack trace', async (t) => {
  await assert.rejects(startBoard(t, {}, true, false, { BOARD_PORT: 'abc' }), (err: Error) =>
    /BOARD_PORT=abc is not a port/.test(err.message) && !/ERR_SOCKET_BAD_PORT|\n\s+at /.test(err.message));
});

test('BOARD_PORT on a taken port exits with a log line', async (t) => {
  const port = await hold(t, 0);
  await assert.rejects(startBoard(t, {}, true, false, { BOARD_PORT: String(port) }), new RegExp(`port ${port} is taken`));
});

test('a live board records its port for status.sh and removes the record on exit; a sample board records nothing', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-records-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const records = join(home, 'Library/Application Support/Lar Factory/boards');
  const sample = await startBoard(t, {}, true, false, { HOME: home });
  const board = await startBoard(t, {}, false, false, { HOME: home });
  assert.deepEqual(readdirSync(records), [`${board.pid}.json`]);
  assert.deepEqual(JSON.parse(readFileSync(join(records, `${board.pid}.json`), 'utf8')), { port: Number(new URL(board.url).port) });
  await sample.stop();
  await board.stop();
  assert.deepEqual(readdirSync(records), []);
});
