import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { BoardData } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { openWorkRecords, workRecordsPath } from '@lar-factory/work-records';
import { checkouts } from './repo-support.ts';
import { earlierShapePrompt, shapePrompt, larWork, startBoard, until, writesRepository, type Board } from './server-support.ts';
import { projectsDb } from './stats-db.ts';

/** A home and T3 database that outlive each board started on them, as this Mac's do across a restart. */
function machine(t: TestContext) {
  const home = mkdtempSync(join(tmpdir(), 'lar-restart-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  checkouts(home, { 'lar-factory': 'git@github.com:maddec01/lar-factory.git' });
  const env = { HOME: home, T3_STATE_DB: projectsDb(t, [{ id: 'project-factory', root: `${home}/Developer/lar/lar-factory` }]) };
  /** Starts a board on this machine with the fake gh and t3 as `options` say, and `extra` in its environment; `recorded` imports issue 12 once, as onboarding did. */
  return (options: object = {}, recorded = false, extra: Record<string, string> = {}) =>
    startBoard(t, { items: [boardIssue(12, 'Queued')], recorded, ...options }, false, false, { ...env, ...extra });
}

const start = (board: Board, workId: string) => board.postSession({ itemId: workId }, '/api/start');
const starts = async (board: Board) => (await board.t3Calls()).filter((args) => args[1] === 'start').length;

/** The launch intents the work record holds, with each one's outcome. */
async function intents(board: Board, workId: string) {
  const records = await openWorkRecords(workRecordsPath(board.dataDir));
  try { return records.launchIntents({ workId }).map(({ threadId, failure, resolvedAt }) => ({ threadId, failure: !!failure, resolved: !!resolvedAt })); }
  finally { records.close(); }
}

test('a database upgraded by another process keeps the board alive with its cached view and one restart notice', { timeout: 20_000 }, async (t) => {
  const board = await machine(t)({}, true);
  const before = await until(board, data => data.fetchedAt !== null && data.firstRead.settled && data.items.some(item => item.id === board.id(12)));
  // Simulate a newer lar-work process after this server has opened the database. No live user data is involved.
  const external = new DatabaseSync(workRecordsPath(board.dataDir));
  try {
    const version = Number(external.prepare('PRAGMA user_version').get()!.user_version);
    external.exec(`PRAGMA user_version = ${version + 1000}`);
  } finally { external.close(); }
  const after = await until(board, data => data.localProblem === 'Restart Lar Factory to continue.');
  assert.deepEqual(after.items, before.items, 'a failed local read preserves the last successful items');
  assert.equal(after.error, 'Restart Lar Factory to continue.');
  assert.equal((await fetch(`${board.url}/healthz`)).status, 200);
  assert.equal((await fetch(`${board.url}/api/board`)).status, 200);
  // Two more local ticks must neither crash the process nor repeat the sanitized diagnostic.
  await new Promise(resolve => setTimeout(resolve, 4200));
  assert.equal((await fetch(`${board.url}/api/board`)).status, 200);
  assert.equal(board.logs().split('local work paused: schema-too-new').length - 1, 1);
  assert.doesNotMatch(board.logs(), /WorkRecordError:|schema version \d+, which is newer/);
});

test('a lar-work write while the board is closed shows after its restart, beside the records it held', { timeout: 30_000 }, async (t) => {
  const boardOn = machine(t);
  const before = await boardOn({ items: [] });
  await until(before, (d) => d.fetchedAt !== null);
  const kept = await larWork(before.dataDir, 'create', '--title', 'Kept', '--repository', 'maddec01/lar-factory', '--kind', 'feature');
  await until(before, (d) => d.items.some((i) => i.id === kept.workId));
  await before.stop();
  const moved = await larWork(before.dataDir, 'update', kept.workId, '--revision', String(kept.revision), '--status', 'Shaping');
  const added = await larWork(before.dataDir, 'create', '--title', 'Written while closed', '--repository', 'maddec01/lar-factory', '--kind', 'bug');
  const after = await boardOn({ items: [] });
  const shown = await until(after, (d) => d.items.length === 2);
  assert.deepEqual(shown.items.map((i) => [i.id, i.status]).sort(), [[kept.workId, 'Shaping'], [added.workId, 'List']].sort());
  assert.equal(moved.revision, kept.revision + 1);
  assert.deepEqual([...await before.calls(), ...await after.calls()].filter(writesRepository), []);
});

test('a successful start holds its thread after a restart, so Start there asks T3 for no other', async (t) => {
  const boardOn = machine(t);
  const before = await boardOn({}, true);
  const workId = before.id(12);
  await until(before, (d) => d.items.some((i) => i.id === workId));
  assert.equal((await start(before, workId)).status, 200);
  await before.stop();
  const after = await boardOn();
  await until(after, (d) => d.items.some((i) => i.id === workId));
  const again = await start(after, workId);
  assert.deepEqual([again.status, (await again.json()).thread?.threadId], [200, 'thread-1']);
  assert.equal(await starts(after), 0);
  assert.deepEqual(await intents(after, workId), [{ threadId: 'thread-1', failure: false, resolved: true }]);
});

test('a failed start stays a failure after a restart, so Start there asks T3 again', async (t) => {
  const boardOn = machine(t);
  const before = await boardOn({}, true);
  const workId = before.id(12);
  await until(before, (d) => d.items.some((i) => i.id === workId));
  await before.stop();
  // No t3 at all is a certain failure: nothing ran, so no thread can exist.
  const missing = await boardOn({}, false, { T3_PATH: '/nonexistent/t3' });
  await until(missing, (d) => d.items.some((i) => i.id === workId));
  const failed = await start(missing, workId);
  assert.equal(failed.status, 502);
  assert.equal((await failed.json()).uncertain, undefined);
  await missing.stop();
  const after = await boardOn();
  await until(after, (d) => d.items.some((i) => i.id === workId));
  assert.equal((await start(after, workId)).status, 200);
  assert.equal(await starts(after), 1);
  assert.deepEqual(await intents(after, workId), [{ threadId: null, failure: true, resolved: true }, { threadId: 'thread-1', failure: false, resolved: true }]);
});

test('a start left unresolved before threads took their phase in their name recovers its thread, and no second one starts', { timeout: 30_000 }, async (t) => {
  const boardOn = machine(t);
  const before = await boardOn({ t3: { fail: 'garbage' } }, true);
  const workId = before.id(12);
  await until(before, (d) => d.items.some((i) => i.id === workId));
  const message = earlierShapePrompt(before,'#12 Issue 12',workId);
  assert.equal((await (await start(before, workId)).json()).uncertain, true);
  await before.stop();

  const after = await boardOn({ t3: { recover: 'late', firstMessage: message } });
  await until(after, (d) => d.items.some((i) => i.id === workId));
  const settled = await start(after, workId);
  assert.deepEqual([settled.status, (await settled.json()).thread?.threadId], [200, 'thread-1']);
  assert.equal(await starts(after), 0);
  assert.deepEqual(await intents(after, workId), [{ threadId: 'thread-1', failure: false, resolved: true }]);
});

test('an uncertain start stays unresolved across a restart: T3 is read before anything, and no second thread starts', { timeout: 30_000 }, async (t) => {
  const boardOn = machine(t);
  const before = await boardOn({ t3: { fail: 'garbage' } }, true);
  const workId = before.id(12);
  await until(before, (d) => d.items.some((i) => i.id === workId));
  const message = shapePrompt(before,'#12 Issue 12',workId);
  assert.equal((await (await start(before, workId)).json()).uncertain, true);
  await before.stop();

  const down = await boardOn({ t3: { fail: 'down' } });
  await until(down, (d) => d.items.some((i) => i.id === workId));
  const unread = await start(down, workId);
  assert.deepEqual([unread.status, (await unread.json()).uncertain], [502, true]);
  assert.equal(await starts(down), 0, "T3 that can't be read permits no retry");
  assert.ok((await down.t3Calls()).some((args) => args[1] === 'list'), 'the restarted board inspects T3 first');
  await down.stop();

  const after = await boardOn({ t3: { recover: 'late', firstMessage: message } });
  await until(after, (d) => d.items.some((i) => i.id === workId));
  const settled = await start(after, workId);
  assert.deepEqual([settled.status, (await settled.json()).thread?.threadId], [200, 'thread-1']);
  assert.equal(await starts(after), 0);
  assert.deepEqual(await intents(after, workId), [{ threadId: 'thread-1', failure: false, resolved: true }]);
  assert.equal((await after.board() as BoardData).items.find((i) => i.id === workId)?.status, 'Queued', 'settling a start moves no Status');
});
