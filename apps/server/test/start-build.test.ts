import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { NOT_LANDED, readsRepositoryConfig, SAMPLE_MODELS, startableEnv, startBoard, until, writeOnboarding } from './server-support.ts';
import type { Board } from './server-support.ts';
import { boardIssue, rawIssue, sliceRef } from '@lar-factory/shared/test/raw-items';
import type { BoardData, RawItem } from '@lar-factory/shared';

/** A Ready issue in lar-factory, with labels and, optionally, a parent. */
const readyIssue = (number: number, labels: string[], parent?: number): RawItem =>
  rawIssue(`I_${number}`, number, 'Ready', labels, parent ? { parent: sliceRef(parent, 'OPEN') } : {});

/** A board that can start lar-factory builds, and the home it runs in; `skillCheck` answers its skill checks as the board app. */
async function buildBoard(t: TestContext, items: object[], options: object = {}, env: Record<string, string> = {}, skillCheck?: () => string | null) {
  const startable = startableEnv(t);
  const board = await startBoard(t, { items, ...options }, false, false, { ...startable, ...env }, undefined, skillCheck);
  await until(board, (d) => d.items.length === items.length);
  return { board, home: startable.HOME! };
}

const startBuild = (board: Board, itemId: string, model?: unknown, origin = board.url) =>
  board.postSession({ itemId, model }, '/api/start-build', origin);

const message = (home: string, number: number) =>
  `Build maddec01/lar-factory#${number}. Read ${home}/.agents/skills/lar-work/agents/builder.md and follow it.`;

const statusEdit = (number: string, status: string) => ['issue', 'edit', number, '-R', 'maddec01/lar-factory', '--add-label', status, '--remove-label', 'status-ready'];

/** The gh calls Start build makes: label and status writes and issue reads, not the board's project reads. */
const writes = async (board: Board) => (await board.calls())
  .filter((args) => args[0] === 'issue' && args[1] === 'edit');

test('Start build labels the build, moves its parent to In progress and starts the build thread in a new worktree', async (t) => {
  const { board, home } = await buildBoard(t, [readyIssue(12, ['feature'], 40), boardIssue(40, 'Ready', undefined, ['concept'])]);
  const response = await startBuild(board, 'I_12');
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.equal(answer.thread.threadId, 'thread-1');
  assert.equal(answer.board.startedBuilds.I_12.threadId, 'thread-1');
  assert.deepEqual(answer.board.items.find((i: { id: string }) => i.id === 'I_12').labels, ['feature', 'status-ready', 'build']);
  assert.equal(answer.board.items.find((i: { id: string }) => i.id === 'I_40').status, 'In progress');
  assert.deepEqual(await writes(board), [
    ['issue', 'edit', '12', '-R', 'maddec01/lar-factory', '--add-label', 'build'],
    statusEdit('40', 'status-in-progress'),
  ]);
  assert.deepEqual(await board.t3Calls(), [
    ['thread', 'start', 'project-factory', message(home, 12), '--worktree', 'main', '--branch', 'feat/12-issue-12', '--json'],
  ]);
});

test('Start build asks the board app to check the skills before it starts the thread', async (t) => {
  const { board, home } = await buildBoard(t, [readyIssue(12, ['build'])], {}, { BOARD_SKILL_CHECK: '1' }, () => null);
  assert.equal((await startBuild(board, 'I_12')).status, 200);
  assert.equal(board.skillChecks(), 1);
  assert.deepEqual((await board.t3Calls()).map((args) => args[3]), [message(home, 12)]);
});

test('a refused skill check refuses Start build with its reason, writes nothing to GitHub and runs no t3', async (t) => {
  let refusal: string | null = 'Lar Factory can\'t check the skill tdd: a folder it didn\'t install has its name.';
  const { board } = await buildBoard(t, [readyIssue(12, ['feature'], 40), boardIssue(40, 'Ready', undefined, ['concept'])],
    {}, { BOARD_SKILL_CHECK: '1' }, () => refusal);
  const refused = await startBuild(board, 'I_12');
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, refusal);
  assert.deepEqual([...await writes(board), ...await board.t3Calls()], []);
  refusal = null;
  assert.equal((await startBuild(board, 'I_12')).status, 200);
  assert.equal(board.skillChecks(), 2);
});

test('without a bundle Start build asks for no skill check', async (t) => {
  const { board } = await buildBoard(t, [readyIssue(12, ['build'])], {}, {}, () => 'refused');
  assert.equal((await startBuild(board, 'I_12')).status, 200);
  assert.equal(board.skillChecks(), 0);
});

test('the build message names lar-work under LAR_FACTORY_INSTALL_ROOT when it is set', async (t) => {
  const { board } = await buildBoard(t, [readyIssue(12, ['build'])], {}, { LAR_FACTORY_INSTALL_ROOT: '/tmp/lar-root' });
  assert.equal((await startBuild(board, 'I_12')).status, 200);
  assert.deepEqual((await board.t3Calls()).map((args) => args[3]), [message('/tmp/lar-root', 12)]);
});

test('Start build runs the thread on the picked model choice', async (t) => {
  const { board, home } = await buildBoard(t, [readyIssue(12, ['bug', 'build'])], {}, SAMPLE_MODELS);
  const response = await startBuild(board, 'I_12', { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5' });
  assert.equal(response.status, 200);
  assert.deepEqual(await board.t3Calls(), [
    ['thread', 'start', 'project-factory', message(home, 12), '--provider', 'claudeAgent_personal', '--model', 'claude-opus-5-5',
      '--worktree', 'main', '--branch', 'fix/12-issue-12', '--json'],
  ]);
  assert.match((await (await startBuild(board, 'I_12', { instanceId: 'codex', model: '--help' })).json()).error, /isn't offered/);
});

test('Start build leaves a labelled build, a parent build and a parent already In progress alone', async (t) => {
  const { board } = await buildBoard(t, [
    readyIssue(12, ['build'], 40), boardIssue(40, 'In progress', undefined, ['build']),
    readyIssue(13, ['build'], 41), boardIssue(41, 'In progress', undefined, ['concept']),
    readyIssue(14, ['improvement', 'build'])]);
  for (const id of ['I_12', 'I_13', 'I_14']) assert.equal((await startBuild(board, id)).status, 200);
  assert.deepEqual(await writes(board), []);
  assert.deepEqual((await board.t3Calls()).map((args) => args[args.indexOf('--branch') + 1]),
    ['chore/12-issue-12', 'chore/13-issue-13', 'feat/14-issue-14']);
});

test("Start build reads the labels of a parent that isn't on the board, and moves its status label", async (t) => {
  const { board } = await buildBoard(t, [readyIssue(12, ['build'], 40), readyIssue(13, ['build'], 41)], {
    issues: { 'maddec01/lar-factory/issues/40': { labels: [{ name: 'concept' }] }, 'maddec01/lar-factory/issues/41': { labels: [{ name: 'build' }] } },
  });
  assert.equal((await startBuild(board, 'I_12')).status, 200);
  assert.equal((await startBuild(board, 'I_13')).status, 200);
  assert.deepEqual(await writes(board), [
    ['issue', 'edit', '40', '-R', 'maddec01/lar-factory', '--add-label', 'status-in-progress'],
  ]);
  assert.equal((await board.t3Calls()).length, 2);
});

for (const [name, fail, error] of [
  ['the label', 'label', /^Could not add the build label\. .*HTTP 403/],
  ["the parent's status", 'status', /^Could not set In progress\. /],
] as const) {
  test(`a failed write to ${name} starts no thread, and Start build can be pressed again`, async (t) => {
    const items = [readyIssue(12, ['feature'], 40), boardIssue(40, 'Ready', undefined, ['concept'])];
    const { board } = await buildBoard(t, items, { fail });
    const failed = await startBuild(board, 'I_12');
    assert.equal(failed.status, 502);
    assert.match((await failed.json()).error, error);
    assert.deepEqual(await board.t3Calls(), []);
    await board.update({ items });
    assert.equal((await startBuild(board, 'I_12')).status, 200);
    assert.equal((await board.t3Calls()).length, 1);
  });
}

test('a refused repository project writes nothing to GitHub and runs no t3', async (t) => {
  const { board } = await buildBoard(t, [rawIssue('I_30', 30, 'Ready', ['feature'],
    { url: 'https://github.com/maddec01/lar-server/issues/30', repository: { nameWithOwner: 'maddec01/lar-server' } })]);
  const response = await startBuild(board, 'I_30');
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error, 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code');
  assert.deepEqual(await writes(board), []);
  assert.deepEqual(await board.t3Calls(), []);
});


test('Start build is refused while an issue the build is blocked by is open, and runs once it closes', async (t) => {
  const blocked = (state: 'OPEN' | 'CLOSED') => rawIssue('I_12', 12, 'Ready', ['build'], {
    blockedBy: { nodes: [{ number: 5, state, repository: { nameWithOwner: 'maddec01/lar-factory' } }] },
  });
  const { board } = await buildBoard(t, [blocked('OPEN')]);
  const refused = await startBuild(board, 'I_12');
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'Blocked by #5 until it closes; use Start after to start it then.');
  assert.deepEqual([...await writes(board), ...await board.t3Calls()], []);
  await board.update({ items: [blocked('CLOSED')] });
  await board.post({}, board.url, '/api/read');
  await until(board, (d) => d.items[0]?.blockers[0]?.state === 'closed');
  assert.equal((await startBuild(board, 'I_12')).status, 200);
});

test("a started build shows in the board data's started builds, apart from the item's refining thread", async (t) => {
  const { board } = await buildBoard(t, [readyIssue(12, ['build'])]);
  const answer = await (await startBuild(board, 'I_12')).json();
  assert.equal(answer.board.startedBuilds.I_12.threadId, 'thread-1');
  assert.equal(answer.board.started?.I_12, undefined);
});

test('a double press, a retry or another page starts no second build thread', async (t) => {
  const { board } = await buildBoard(t, [readyIssue(12, ['build'])], { t3: { delay: 100 } });
  const responses = await Promise.all([startBuild(board, 'I_12'), startBuild(board, 'I_12')]);
  assert.deepEqual(responses.map((r) => r.status), [200, 200]);
  assert.equal((await startBuild(board, 'I_12')).status, 200);
  assert.equal((await board.t3Calls()).length, 1);
});

for (const fail of ['killed', 'garbage']) {
  test(`an unconfirmed build start (${fail}) is never retried as a new thread`, async (t) => {
    const { board } = await buildBoard(t, [readyIssue(12, ['build'])], { t3: { fail } });
    assert.equal((await (await startBuild(board, 'I_12')).json()).uncertain, true);
    assert.equal((await (await startBuild(board, 'I_12')).json()).uncertain, true);
    assert.equal((await board.t3Calls()).length, 1);
  });
}

test('Start build only runs for Ready issues from this board page and session', async (t) => {
  const { board } = await buildBoard(t, [boardIssue(12, 'Queued')]);
  assert.match((await (await startBuild(board, 'I_12')).json()).error, /^Only Ready items can start a build; this one is in Queued\.$/);
  assert.equal((await startBuild(board, 'I_missing')).status, 404);
  const restarted = await board.post({ session: 'old', itemId: 'I_12' }, board.url, '/api/start-build');
  assert.equal(restarted.status, 409);
  assert.match((await restarted.json()).error, /Press Start build again/);
  assert.equal((await startBuild(board, 'I_12', undefined, 'https://evil.example')).status, 403);
  const sample = await startBoard(t, {}, true);
  assert.equal((await startBuild(sample, 'I_sample05')).status, 403);
  assert.deepEqual([...await writes(board), ...await board.t3Calls(), ...await sample.t3Calls()], []);
});

test('the board data says, per repository, whether Start build finds its repository project', async (t) => {
  const { board } = await buildBoard(t, [boardIssue(12, 'Ready')]);
  const data = await until(board, (d) => !!d.repositoryProjects) as BoardData;
  assert.deepEqual(data.repositoryProjects, {
    'maddec01/lar-server': 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code',
    'maddec01/lar-apple': 'No T3 project is a checkout of maddec01/lar-apple; add the checkout in T3 Code',
    'maddec01/lar-factory': null,
  });
});
