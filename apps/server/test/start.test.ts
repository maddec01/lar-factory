import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { draftItem, SAMPLE_MODELS, startBoard, until, writeRepositoryList } from './server-support.ts';
import type { Board } from './server-support.ts';
import { projectIssue, rawIssue } from '@lar-factory/shared/test/raw-items';
import { checkouts } from './repo-support.ts';
import { projectsDb } from './stats-db.ts';
import type { FixtureProject } from './stats-db.ts';
import type { BoardData } from '@lar-factory/shared';

const MESSAGE = '#12 Issue 12\n$lar-work maddec01/lar-factory#12';

/** A temporary home with git checkouts of the given origins under ~/Developer/lar. */
function home(t: TestContext, origins: Record<string, string | null>): string {
  const dir = mkdtempSync(join(tmpdir(), 'lar-start-home-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  checkouts(dir, origins);
  return dir;
}

/** A board whose home has the checkouts, and whose T3 database is the one db(home) returns. */
async function boardIn(t: TestContext, items: object[], origins: Record<string, string | null>,
  db: (home: string) => string, options: object = {}, env: Record<string, string> = {}) {
  const dir = home(t, origins);
  const board = await startBoard(t, { items, ...options }, false, false, { HOME: dir, T3_STATE_DB: db(dir), ...env });
  await until(board, (d) => d.items.length === items.length);
  return { board, home: dir };
}

/** The live lar project holds every checkout but is no checkout itself, so only origins tell repositories apart. */
const PROJECTS = (dir: string): FixtureProject[] => [
  { id: 'project-lar', root: `${dir}/Developer/lar` },
  { id: 'project-factory', root: `${dir}/Developer/lar/lar-factory/` },
  { id: 'project-server-old', root: `${dir}/Developer/lar/lar-server`, deletedAt: '2026-10-01T00:00:00Z' },
  { id: 'project-server', root: '~/Developer/lar/lar-server' },
];
const ORIGINS = {
  'lar-factory': 'git@github.com:maddec01/lar-factory.git',
  'lar-server': 'https://github.com/MADDEC01/Lar-Server',
};

async function factoryBoard(t: TestContext, items: object[], options: object = {}, env: Record<string, string> = {}) {
  return (await boardIn(t, items, ORIGINS, (dir) => projectsDb(t, PROJECTS(dir)), options, env)).board;
}

const draft = draftItem('Queued');

const start = (board: Board, itemId: string, origin = board.url, model?: unknown) => board.postSession({ itemId, model }, '/api/start', origin);

test("Start begins one lar-work thread in the card's repository project and leaves the Status alone", async (t) => {
  const board = await factoryBoard(t, [projectIssue(12, 'Queued'), projectIssue(30, 'Queued', 'maddec01/lar-server')]);
  const response = await start(board, 'I_12');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).thread, { threadId: 'thread-1', title: '#12 Issue 12' });
  assert.equal((await start(board, 'I_30')).status, 200);
  assert.deepEqual(await board.t3Calls(), [
    ['thread', 'start', 'project-factory', MESSAGE, '--json'],
    ['thread', 'start', 'project-server', '#30 Issue 30\n$lar-work maddec01/lar-server#30', '--json'],
  ]);
  assert.equal((await board.calls()).filter((args) => args[1] === 'item-edit').length, 0);
});

test('Start runs the thread on the picked model choice, still in the repository project', async (t) => {
  const board = await factoryBoard(t, [projectIssue(12, 'Queued')], {}, SAMPLE_MODELS);
  const response = await start(board, 'I_12', board.url, { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5' });
  assert.equal(response.status, 200);
  assert.deepEqual(await board.t3Calls(), [
    ['thread', 'start', 'project-factory', MESSAGE, '--provider', 'claudeAgent_personal', '--model', 'claude-opus-5-5', '--json'],
  ]);
});

test('the board data offers the model choices', async (t) => {
  const board = await factoryBoard(t, [projectIssue(12, 'Queued')], {}, SAMPLE_MODELS);
  const groups = (await board.board() as BoardData).modelChoices;
  assert.deepEqual(groups?.map((g) => g.name), ['Personal', 'VI', 'Codex']);
});

for (const [name, model] of [
  ['an unknown instance', { instanceId: 'claudeAgent_work', model: 'claude-opus-5-5' }],
  ['a disabled instance', { instanceId: 'cursor', model: 'cursor-agent' }],
  ['an unknown model', { instanceId: 'codex', model: 'claude-opus-5-5' }],
  ['an instance alone', { instanceId: 'codex' }],
  ['a model alone', { model: 'gpt-6-astra' }],
  ['a flag in place of a model', { instanceId: 'codex', model: '--help' }],
  ['no object', 'codex/gpt-6-astra'],
] as const) {
  test(`Start refuses ${name} as the model choice and runs no t3`, async (t) => {
    const board = await factoryBoard(t, [projectIssue(12, 'Queued')], {}, SAMPLE_MODELS);
    const response = await start(board, 'I_12', board.url, model);
    assert.equal(response.status, 422);
    assert.match((await response.json()).error, /isn't offered/);
    assert.deepEqual(await board.t3Calls(), []);
  });
}

test('Start finds the repository project by origin, whatever its folder is called or wherever it lives', async (t) => {
  const { board } = await boardIn(t, [projectIssue(12, 'Queued')], {}, (dir) => {
    checkouts(dir, { 'factory-clone': 'https://github.com/maddec01/lar-factory' }, 'code');
    return projectsDb(t, [{ id: 'project-lar', root: `${dir}/Developer/lar` },
      { id: 'project-clone', root: '~/code/factory-clone' }]);
  });
  assert.equal((await start(board, 'I_12')).status, 200);
  assert.equal((await board.t3Calls())[0]?.[2], 'project-clone');
});

const NO_PROJECT = 'No T3 project is a checkout of maddec01/lar-factory; add the checkout in T3 Code';

/** A folder whose `.git` is a file, as in a git worktree of the lar-factory checkout. */
function worktree(dir: string): string {
  const folder = join(dir, 'worktrees/lar-factory-1');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, '.git'), `gitdir: ${dir}/Developer/lar/lar-factory/.git\n`);
  return folder;
}

const refusals: { name: string; repo?: string; origins?: Record<string, string | null>;
  projects?: (home: string) => FixtureProject[]; db?: (home: string) => string; error: (home: string) => string }[] = [
  { name: 'an unlisted repository', repo: 'maddec01/other',
    error: () => "maddec01/other isn't onboarded; add it to the board's repositories" },
  { name: 'a project whose folder is gone', origins: {}, error: () => NO_PROJECT },
  { name: "another repository's checkout", origins: { 'lar-factory': 'https://github.com/maddec01/lar-server.git' },
    error: () => NO_PROJECT },
  { name: 'a checkout with no origin', origins: { 'lar-factory': null }, error: () => NO_PROJECT },
  { name: 'a deleted T3 project', projects: (dir) => [{ id: 'project-lar', root: `${dir}/Developer/lar` },
    { id: 'project-factory', root: `${dir}/Developer/lar/lar-factory`, deletedAt: '2026-10-01T00:00:00Z' }],
    error: () => NO_PROJECT },
  { name: 'a worktree or a folder inside the checkout', projects: (dir) => [
    { id: 'project-worktree', root: worktree(dir) }, { id: 'project-board', root: `${dir}/Developer/lar/lar-factory/board` }],
    error: () => NO_PROJECT },
  { name: 'two checkouts of the repository',
    projects: (dir) => {
      checkouts(dir, { 'factory-clone': 'git@github.com:maddec01/lar-factory.git' }, 'code');
      return [...PROJECTS(dir), { id: 'project-clone', root: `${dir}/code/factory-clone` }];
    },
    error: () => 'Several T3 projects are checkouts of maddec01/lar-factory: ~/Developer/lar/lar-factory, ~/code/factory-clone; remove all but one in T3 Code' },
  { name: 'a missing T3 database', db: (dir) => join(dir, 'none.sqlite'),
    error: (dir) => `Can't read T3 Code's projects at ${join(dir, 'none.sqlite')}` },
];

for (const refusal of refusals) {
  test(`Start refuses ${refusal.name} with a hint and runs no t3`, async (t) => {
    const item = projectIssue(12, 'Queued', refusal.repo);
    const { board, home: dir } = await boardIn(t, [item], refusal.origins ?? ORIGINS,
      refusal.db ?? ((dir) => projectsDb(t, (refusal.projects ?? PROJECTS)(dir))));
    const response = await start(board, 'I_12');
    assert.equal(response.status, 409, 'a refusal is not a t3 failure');
    const answer = await response.json();
    assert.equal(answer.error, refusal.error(dir));
    assert.equal(answer.uncertain, undefined, 'a refused Start can be pressed again');
    assert.deepEqual(await board.t3Calls(), []);
  });
}

test('Start refuses a T3 database whose schema changed', async (t) => {
  let db = '';
  const { board } = await boardIn(t, [projectIssue(12, 'Queued')], ORIGINS, (dir) => {
    db = join(dir, 'changed.sqlite');
    const changed = new DatabaseSync(db);
    changed.exec('CREATE TABLE projection_projects (id TEXT)');
    changed.close();
    return db;
  });
  const response = await start(board, 'I_12');
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, `Can't read T3 Code's projects at ${db}`);
  assert.deepEqual(await board.t3Calls(), []);
});

test("a card's repository matches its entry in the list of onboarded repositories whatever the case", async (t) => {
  const board = await factoryBoard(t, [projectIssue(12, 'Queued', 'MADDEC01/Lar-Factory')]);
  const response = await start(board, 'I_12');
  assert.equal(response.status, 200);
  assert.equal((await board.t3Calls())[0]?.[2], 'project-factory');
});

test('Start reads the list of onboarded repositories each time, so a repository onboarded later starts without restarting the board', async (t) => {
  const dir = home(t, ORIGINS);
  writeRepositoryList(dir, ['maddec01/elsewhere']);
  const board = await startBoard(t, { items: [projectIssue(12, 'Queued')] }, false, false, { HOME: dir, T3_STATE_DB: projectsDb(t, PROJECTS(dir)) });
  await until(board, (d) => d.items.length === 1);
  const refused = await start(board, 'I_12');
  assert.match((await refused.json()).error, /maddec01\/lar-factory isn't onboarded/);
  writeRepositoryList(dir, ['maddec01/elsewhere', 'maddec01/lar-factory']);
  const retried = await start(board, 'I_12');
  assert.equal(retried.status, 200);
  assert.equal((await board.t3Calls())[0]?.[2], 'project-factory');
});

test('Start refuses an unreadable list of onboarded repositories, naming the file', async (t) => {
  const dir = home(t, ORIGINS);
  const board = await startBoard(t, { items: [projectIssue(12, 'Queued')] }, false, false, { HOME: dir, T3_STATE_DB: projectsDb(t, PROJECTS(dir)) });
  await until(board, (d) => d.items.length === 1);
  writeFileSync(join(dir, 'Library/Application Support/Lar Factory/repositories.json'), '{ broken');
  const response = await start(board, 'I_12');
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /repositories\.json isn't valid JSON/);
  assert.deepEqual(await board.t3Calls(), []);
});

test('a thread T3 returns untitled takes the first line of the work message as its title', async (t) => {
  const board = await factoryBoard(t, [projectIssue(12, 'Queued')], { t3: { untitled: true } });
  const response = await start(board, 'I_12');
  assert.deepEqual((await response.json()).thread, { threadId: 'thread-1', title: '#12 Issue 12' });
});

test('a double press, a retry or another page starts no second thread for the item', async (t) => {
  const board = await factoryBoard(t, [projectIssue(12, 'Queued'), projectIssue(13, 'Queued')], { t3: { delay: 100 } });
  const responses = await Promise.all([start(board, 'I_12'), start(board, 'I_12')]);
  assert.deepEqual(responses.map((r) => r.status), [200, 200]);
  assert.equal((await start(board, 'I_12')).status, 200);
  const thread = { threadId: 'thread-1', title: '#12 Issue 12' };
  assert.deepEqual((await board.board() as BoardData).started, { I_12: thread }, 'a reloaded page sees the thread');
  assert.equal((await start(board, 'I_13')).status, 200, 'another item starts its own thread');
  assert.equal((await board.t3Calls()).length, 2);
});

test('a T3 error is shown and the same request can try again', async (t) => {
  const board = await factoryBoard(t, [projectIssue(12, 'Queued')], { t3: { fail: 'down' } });
  const failed = await start(board, 'I_12');
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /Is T3 Code running\?/);
  await board.update({ items: [projectIssue(12, 'Queued')] });
  assert.equal((await start(board, 'I_12')).status, 200);
  assert.equal((await board.t3Calls()).length, 2);
});

for (const fail of ['killed', 'garbage']) {
  test(`an unconfirmed start (${fail}) is never retried as a new thread`, async (t) => {
    const board = await factoryBoard(t, [projectIssue(12, 'Queued')], { t3: { fail } });
    const first = await start(board, 'I_12');
    assert.equal(first.status, 502);
    assert.equal((await first.json()).uncertain, true);
    await board.update({ items: [projectIssue(12, 'Queued')] });
    assert.equal((await (await start(board, 'I_12')).json()).uncertain, true);
    assert.equal((await board.t3Calls()).length, 1);
  });
}

test('a missing t3 says how to point the board at it', async (t) => {
  const board = await factoryBoard(t, [projectIssue(12, 'Queued')], {}, { T3_PATH: '/nonexistent/t3' });
  const response = await start(board, 'I_12');
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /T3_PATH/);
});

test('Start only runs for Queued issues from this board page and session', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(12, 'List'), projectIssue(13, 'Ready'), projectIssue(14, 'Queued'), draft] });
  await until(board, (d) => d.items.length === 4);
  assert.equal((await start(board, 'I_12')).status, 409);
  assert.equal((await start(board, 'I_13')).status, 409);
  assert.match((await (await start(board, 'DI_draft')).json()).error, /needs an issue/);
  assert.equal((await start(board, 'I_missing')).status, 404);
  assert.equal((await board.post({ session: (await board.board()).capture.session, itemId: 14 }, board.url, '/api/start')).status, 400);
  const restarted = await board.post({ session: 'old', itemId: 'I_14' }, board.url, '/api/start');
  assert.equal(restarted.status, 409);
  const answer = await restarted.json();
  assert.ok(!answer.uncertain && answer.board.capture.session, 'a stale page gets the new session and can press Start again');
  for (const origin of ['https://evil.example', 'null', '']) assert.equal((await start(board, 'I_14', origin)).status, 403);
  const sample = await startBoard(t, {}, true);
  assert.equal((await start(sample, 'I_sample05')).status, 403);
  assert.deepEqual([...await board.t3Calls(), ...await sample.t3Calls()], []);
});

test('Start is refused while an issue the item is blocked by is open', async (t) => {
  const blocked = rawIssue('PVTI_12', 12, 'Queued', ['decision: grill'], {
    blockedBy: { nodes: [5, 6].map((number) => ({ number, state: 'OPEN', repository: { nameWithOwner: number === 5 ? 'maddec01/lar-factory' : 'maddec01/lar-server' } })) },
  });
  const board = await factoryBoard(t, [blocked]);
  const refused = await start(board, 'I_12');
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'Blocked by #5, maddec01/lar-server#6 until they close; use Start after to start it then.');
  assert.deepEqual(await board.t3Calls(), []);
});

test('Start is refused while Back to List or Abandon is pending for the item', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(12, 'Queued'), projectIssue(13, 'Queued')], writeDelay: 300 });
  await until(board, (d) => d.items.length === 2);
  const moving = board.post({ itemId: 'I_12' }, board.url, '/api/back-to-list');
  const abandoning = board.postSession({ itemId: 'I_13' }, '/api/abandon');
  await new Promise((r) => setTimeout(r, 100));
  const refusedMove = await start(board, 'I_12');
  assert.equal(refusedMove.status, 409);
  assert.equal((await refusedMove.json()).error, 'This item is moving back to List, so it can\'t start.');
  const refusedAbandon = await start(board, 'I_13');
  assert.equal(refusedAbandon.status, 409);
  assert.equal((await refusedAbandon.json()).error, 'This item is being abandoned, so it can\'t start.');
  assert.deepEqual((await Promise.all([moving, abandoning])).map((r) => r.status), [200, 200]);
  assert.deepEqual(await board.t3Calls(), []);
});
