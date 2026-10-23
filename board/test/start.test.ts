import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { rawIssue, startBoard } from './server-support.ts';
import { checkouts, factoryRepo } from './repo-support.ts';
import { projectsDb } from './stats-db.ts';
import type { FixtureProject } from './stats-db.ts';
import { expandHome } from '../src/config.ts';
import type { BoardData } from '../src/model.ts';

type Board = Awaited<ReturnType<typeof startBoard>>;

const MESSAGE = '#12 Issue 12\n$mux-work maddec01/mux-factory#12';

/** A temporary home with git checkouts of the given origins where config.json's paths point. */
function home(t: TestContext, origins: Record<string, string | null>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mux-start-home-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  checkouts(dir, origins);
  return dir;
}

/** A board whose home has the checkouts, and whose T3 database is the one db(home) returns. */
async function boardIn(t: TestContext, items: object[], origins: Record<string, string | null>,
  db: (home: string) => string, options: object = {}, env: Record<string, string> = {}) {
  const dir = home(t, origins);
  const board = await startBoard(t, { items, ...options }, false, false, { HOME: dir, T3_STATE_DB: db(dir), ...env });
  await ready(board, items.length);
  return { board, home: dir };
}

/** The live Mux project holds every checkout, so only the project id tells repositories apart. */
const PROJECTS = (dir: string): FixtureProject[] => [
  { id: 'project-mux', root: `${dir}/Developer/Mux` },
  { id: 'project-factory', root: `${dir}/Developer/Mux/mux-factory/` },
  { id: 'project-server-old', root: `${dir}/Developer/Mux/mux-server`, deletedAt: '2026-10-01T00:00:00Z' },
  { id: 'project-server', root: '~/Developer/Mux/mux-server' },
];
const ORIGINS = {
  'mux-factory': 'git@github.com:maddec01/mux-factory.git',
  'mux-server': 'https://github.com/MADDEC01/Mux-Server',
};

async function factoryBoard(t: TestContext, items: object[], options: object = {}, env: Record<string, string> = {}) {
  return (await boardIn(t, items, ORIGINS, (dir) => projectsDb(t, PROJECTS(dir)), options, env)).board;
}

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
});

test("Start begins one mux-work thread in the card's repository project and leaves the Status alone", async (t) => {
  const board = await factoryBoard(t, [rawIssue(12, 'Queued'), rawIssue(30, 'Queued', 'maddec01/mux-server')]);
  const response = await start(board, 'PVTI_12');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).thread, { threadId: 'thread-1', title: '#12 Issue 12' });
  assert.equal((await start(board, 'PVTI_30')).status, 200);
  assert.deepEqual(await board.t3Calls(), [
    ['thread', 'start', 'project-factory', MESSAGE, '--json'],
    ['thread', 'start', 'project-server', '#30 Issue 30\n$mux-work maddec01/mux-server#30', '--json'],
  ]);
  assert.equal((await board.calls()).filter((args) => args[1] === 'item-edit').length, 0);
});

const refusals: { name: string; repo?: string; origins?: Record<string, string | null>;
  projects?: (home: string) => FixtureProject[]; db?: (home: string) => string; error: (home: string) => string }[] = [
  { name: 'an unlisted repository', repo: 'maddec01/other',
    error: () => "maddec01/other isn't in config.json; add it with a path and role" },
  { name: 'a missing checkout', origins: {},
    error: () => "mux-factory isn't at ~/Developer/Mux/mux-factory; update its path in config.json" },
  { name: "another repository's checkout", origins: { 'mux-factory': 'https://github.com/maddec01/mux-server.git' },
    error: () => '~/Developer/Mux/mux-factory is a checkout of maddec01/mux-server, not maddec01/mux-factory; update its path in config.json' },
  { name: 'a checkout with no origin', origins: { 'mux-factory': null },
    error: () => '~/Developer/Mux/mux-factory is a checkout of no GitHub repository, not maddec01/mux-factory; update its path in config.json' },
  { name: 'no live T3 project', projects: (dir) => [{ id: 'project-mux', root: `${dir}/Developer/Mux` },
    { id: 'project-factory', root: `${dir}/Developer/Mux/mux-factory`, deletedAt: '2026-10-01T00:00:00Z' }],
    error: () => 'No T3 project for ~/Developer/Mux/mux-factory; add it in T3 Code' },
  { name: 'a missing T3 database', db: (dir) => join(dir, 'none.sqlite'),
    error: (dir) => `Can't read T3 Code's projects at ${join(dir, 'none.sqlite')}` },
];

for (const refusal of refusals) {
  test(`Start refuses ${refusal.name} with a hint and runs no t3`, async (t) => {
    const item = rawIssue(12, 'Queued', refusal.repo);
    const { board, home: dir } = await boardIn(t, [item], refusal.origins ?? ORIGINS,
      refusal.db ?? ((dir) => projectsDb(t, (refusal.projects ?? PROJECTS)(dir))));
    const response = await start(board, 'PVTI_12');
    assert.equal(response.status, 409, 'a refusal is not a t3 failure');
    const answer = await response.json();
    assert.equal(answer.error, refusal.error(dir));
    assert.equal(answer.uncertain, undefined, 'a refused Start can be pressed again');
    assert.deepEqual(await board.t3Calls(), []);
  });
}

test('Start refuses a T3 database whose schema changed', async (t) => {
  let db = '';
  const { board } = await boardIn(t, [rawIssue(12, 'Queued')], ORIGINS, (dir) => {
    db = join(dir, 'changed.sqlite');
    const changed = new DatabaseSync(db);
    changed.exec('CREATE TABLE projection_projects (id TEXT)');
    changed.close();
    return db;
  });
  const response = await start(board, 'PVTI_12');
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, `Can't read T3 Code's projects at ${db}`);
  assert.deepEqual(await board.t3Calls(), []);
});

test("a card's repository matches its config.json entry whatever the case", async (t) => {
  const board = await factoryBoard(t, [rawIssue(12, 'Queued', 'MADDEC01/Mux-Factory')]);
  const response = await start(board, 'PVTI_12');
  assert.equal(response.status, 200);
  assert.equal((await board.t3Calls())[0]?.[2], 'project-factory');
});

test('Start reads config.json each time, so a fixed path works without restarting the board', async (t) => {
  const f = await factoryRepo(t);
  const config = join(f.repo, 'config.json');
  const original = readFileSync(config, 'utf8');
  writeFileSync(config, original.replace('~/Developer/Mux/mux-factory', '~/Developer/Mux/elsewhere'));
  const dir = home(t, ORIGINS);
  const board = await startBoard(t, { items: [rawIssue(12, 'Queued')] }, false, false,
    { HOME: dir, T3_STATE_DB: projectsDb(t, PROJECTS(dir)) }, join(f.repo, 'board'));
  await ready(board, 1);
  const refused = await start(board, 'PVTI_12');
  assert.match((await refused.json()).error, /isn't at ~\/Developer\/Mux\/elsewhere/);
  writeFileSync(config, original);
  const retried = await start(board, 'PVTI_12');
  assert.equal(retried.status, 200);
  assert.equal((await board.t3Calls())[0]?.[2], 'project-factory');
});

test('Start refuses an unreadable config.json with a hint', async (t) => {
  const f = await factoryRepo(t);
  const dir = home(t, ORIGINS);
  const board = await startBoard(t, { items: [rawIssue(12, 'Queued')] }, false, false,
    { HOME: dir, T3_STATE_DB: projectsDb(t, PROJECTS(dir)) }, join(f.repo, 'board'));
  await ready(board, 1);
  writeFileSync(join(f.repo, 'config.json'), '{ broken');
  const response = await start(board, 'PVTI_12');
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /config\.json/);
  assert.deepEqual(await board.t3Calls(), []);
});

test('a thread T3 returns untitled takes the first line of the work message as its title', async (t) => {
  const board = await factoryBoard(t, [rawIssue(12, 'Queued')], { t3: { untitled: true } });
  const response = await start(board, 'PVTI_12');
  assert.deepEqual((await response.json()).thread, { threadId: 'thread-1', title: '#12 Issue 12' });
});

test('a double press, a retry or another page starts no second thread for the item', async (t) => {
  const board = await factoryBoard(t, [rawIssue(12, 'Queued'), rawIssue(13, 'Queued')], { t3: { delay: 100 } });
  const responses = await Promise.all([start(board, 'PVTI_12'), start(board, 'PVTI_12')]);
  assert.deepEqual(responses.map((r) => r.status), [200, 200]);
  assert.equal((await start(board, 'PVTI_12')).status, 200);
  const thread = { threadId: 'thread-1', title: '#12 Issue 12' };
  assert.deepEqual((await board.board() as BoardData).started, { PVTI_12: thread }, 'a reloaded page sees the thread');
  assert.equal((await start(board, 'PVTI_13')).status, 200, 'another item starts its own thread');
  assert.equal((await board.t3Calls()).length, 2);
});

test('a T3 error is shown and the same request can try again', async (t) => {
  const board = await factoryBoard(t, [rawIssue(12, 'Queued')], { t3: { fail: 'down' } });
  const failed = await start(board, 'PVTI_12');
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /Is T3 Code running\?/);
  await board.update({ items: [rawIssue(12, 'Queued')] });
  assert.equal((await start(board, 'PVTI_12')).status, 200);
  assert.equal((await board.t3Calls()).length, 2);
});

for (const fail of ['killed', 'garbage']) {
  test(`an unconfirmed start (${fail}) is never retried as a new thread`, async (t) => {
    const board = await factoryBoard(t, [rawIssue(12, 'Queued')], { t3: { fail } });
    const first = await start(board, 'PVTI_12');
    assert.equal(first.status, 502);
    assert.equal((await first.json()).uncertain, true);
    await board.update({ items: [rawIssue(12, 'Queued')] });
    assert.equal((await (await start(board, 'PVTI_12')).json()).uncertain, true);
    assert.equal((await board.t3Calls()).length, 1);
  });
}

test('a missing t3 says how to point the board at it', async (t) => {
  const board = await factoryBoard(t, [rawIssue(12, 'Queued')], {}, { T3_PATH: '/nonexistent/t3' });
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
