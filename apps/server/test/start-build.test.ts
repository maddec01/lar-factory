import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { openWorkRecords, workRecordsPath } from '@lar-factory/work-records';
import { NOT_LANDED, readsRepositoryConfig, SAMPLE_MODELS, startableEnv, startBoard, until, writeOnboarding } from './server-support.ts';
import type { Board } from './server-support.ts';
import { boardIssue, rawIssue, sliceRef } from '@lar-factory/shared/test/raw-items';
import type { BoardData, DriftChoice, RawItem, SkillCheckOutcome } from '@lar-factory/shared';

/** A Ready issue in lar-factory, with labels and, optionally, a parent. */
const readyIssue = (number: number, labels: string[], parent?: number): RawItem =>
  rawIssue(`I_${number}`, number, 'Ready', labels, parent ? { parent: sliceRef(parent, 'OPEN') } : {});

/** A board that can start lar-factory builds, and the home it runs in; `skillCheck` answers its skill checks as the board app. */
async function buildBoard(t: TestContext, items: object[], options: object = {}, env: Record<string, string> = {},
  skillCheck?: (drift?: DriftChoice) => string | null | SkillCheckOutcome) {
  const startable = startableEnv(t);
  const board = await startBoard(t, { items, ...options }, false, false, { ...startable, ...env }, undefined, skillCheck);
  await until(board, (d) => d.items.length === items.length);
  return { board, home: startable.HOME! };
}

const startBuild = (board: Board, itemId: string, model?: unknown, origin = board.url, drift?: unknown) =>
  board.postSession({ itemId, model, drift }, '/api/start-build', origin);

const message = (home: string, workId: string) =>
  `Build ${workId}. Read ${home}/.agents/skills/lar-build/agents/builder.md and follow it.`;

/** The issue edits Start build might make, which it never does: its work records hold the moves. */
const writes = async (board: Board) => (await board.calls())
  .filter((args) => args[0] === 'issue' && args[1] === 'edit');

test("Start build moves its concept's work record to In progress, writes nothing to GitHub and starts the build thread in a new worktree", async (t) => {
  const { board, home } = await buildBoard(t, [readyIssue(12, ['build'], 40), boardIssue(40, 'Ready', undefined, ['concept'])]);
  const response = await startBuild(board, board.id(12));
  assert.equal(response.status, 200);
  const answer = await response.json();
  assert.equal(answer.thread.threadId, 'thread-1');
  assert.equal(answer.board.startedBuilds[board.id(12)].threadId, 'thread-1');
  assert.equal(answer.board.items.find((i: { id: string }) => i.id === board.id(40)).status, 'In progress');
  const records = await openWorkRecords(workRecordsPath(board.dataDir));
  try { assert.equal(records.read(board.id(40)).status, 'In progress'); } finally { records.close(); }
  assert.deepEqual(await writes(board), []);
  assert.deepEqual(await board.t3Calls(), [
    ['thread', 'start', 'project-factory', message(home, board.id(12)), '--worktree', 'main', '--branch', 'chore/12-issue-12', '--json'],
  ]);
});

test('Start build asks the board app to check the skills before it starts the thread', async (t) => {
  const { board, home } = await buildBoard(t, [readyIssue(12, ['build'])], {}, { BOARD_SKILL_CHECK: '1' }, () => null);
  assert.equal((await startBuild(board, board.id(12))).status, 200);
  assert.equal(board.skillChecks(), 1);
  assert.deepEqual((await board.t3Calls()).map((args) => args[3]), [message(home, board.id(12))]);
});

test('a refused skill check refuses Start build with its reason, writes nothing to GitHub and runs no t3', async (t) => {
  let refusal: string | null = 'Lar Factory can\'t check the skill tdd: a folder it didn\'t install has its name.';
  const { board } = await buildBoard(t, [readyIssue(12, ['feature'], 40), boardIssue(40, 'Ready', undefined, ['concept'])],
    {}, { BOARD_SKILL_CHECK: '1' }, () => refusal);
  const refused = await startBuild(board, board.id(12));
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, refusal);
  assert.deepEqual([...await writes(board), ...await board.t3Calls()], []);
  refusal = null;
  assert.equal((await startBuild(board, board.id(12))).status, 200);
  assert.equal(board.skillChecks(), 2);
});

test('Drift asks for a choice before Start build writes anything, then starts on the choice the User sends', async (t) => {
  const choices: (DriftChoice | undefined)[] = [];
  const { board, home } = await buildBoard(t, [readyIssue(12, ['feature'], 40), boardIssue(40, 'Ready', undefined, ['concept'])],
    {}, { BOARD_SKILL_CHECK: '1' }, (drift) => {
      choices.push(drift);
      return drift ? null : { refusal: 'Some skills changed: lar-build. Replace them or start anyway.', drift: ['lar-build'] };
    });
  const asked = await startBuild(board, board.id(12));
  assert.equal(asked.status, 409);
  const answer = await asked.json();
  assert.deepEqual([answer.error, answer.drift, answer.thread], ['Some skills changed: lar-build. Replace them or start anyway.', ['lar-build'], null]);
  assert.deepEqual([...await writes(board), ...await board.t3Calls()], []);
  assert.equal((await startBuild(board, board.id(12), undefined, board.url, 'keep')).status, 200);
  assert.deepEqual(choices, [undefined, 'keep']);
  assert.deepEqual((await board.t3Calls()).map((args) => args[3]), [message(home, board.id(12))]);
});

test('Start build refuses a Drift choice it doesn\'t know without checking the skills', async (t) => {
  const { board } = await buildBoard(t, [readyIssue(12, ['build'])], {}, { BOARD_SKILL_CHECK: '1' }, () => null);
  const refused = await startBuild(board, board.id(12), undefined, board.url, 'overwrite');
  assert.equal(refused.status, 422);
  assert.equal(board.skillChecks(), 0);
});

test('without a bundle Start build asks for no skill check', async (t) => {
  const { board } = await buildBoard(t, [readyIssue(12, ['build'])], {}, {}, () => 'refused');
  assert.equal((await startBuild(board, board.id(12))).status, 200);
  assert.equal(board.skillChecks(), 0);
});

test('the build message names lar-build under LAR_FACTORY_INSTALL_ROOT when it is set', async (t) => {
  const { board } = await buildBoard(t, [readyIssue(12, ['build'])], {}, { LAR_FACTORY_INSTALL_ROOT: '/tmp/lar-root' });
  assert.equal((await startBuild(board, board.id(12))).status, 200);
  assert.deepEqual((await board.t3Calls()).map((args) => args[3]), [message('/tmp/lar-root', board.id(12))]);
});

test('Start build runs the thread on the picked model choice', async (t) => {
  const { board, home } = await buildBoard(t, [readyIssue(12, ['bug', 'build'])], {}, SAMPLE_MODELS);
  const response = await startBuild(board, board.id(12), { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5' });
  assert.equal(response.status, 200);
  assert.deepEqual(await board.t3Calls(), [
    ['thread', 'start', 'project-factory', message(home, board.id(12)), '--provider', 'claudeAgent_personal', '--model', 'claude-opus-5-5',
      '--worktree', 'main', '--branch', 'fix/12-issue-12', '--json'],
  ]);
  assert.match((await (await startBuild(board, board.id(12), { instanceId: 'codex', model: '--help' })).json()).error, /isn't offered/);
});

test('Start build leaves a labelled build, a parent build and a parent already In progress alone', async (t) => {
  const { board } = await buildBoard(t, [
    readyIssue(12, ['build'], 40), boardIssue(40, 'In progress', undefined, ['build']),
    readyIssue(13, ['build'], 41), boardIssue(41, 'In progress', undefined, ['concept']),
    readyIssue(14, ['improvement', 'build'])]);
  for (const id of [board.id(12), board.id(13), board.id(14)]) assert.equal((await startBuild(board, id)).status, 200);
  assert.deepEqual(await writes(board), []);
  assert.deepEqual((await board.t3Calls()).map((args) => args[args.indexOf('--branch') + 1]),
    ['chore/12-issue-12', 'chore/13-issue-13', 'feat/14-issue-14']);
});

test('a refused repository project writes nothing to GitHub and runs no t3', async (t) => {
  const { board } = await buildBoard(t, [rawIssue('I_30', 30, 'Ready', ['feature'],
    { url: 'https://github.com/maddec01/lar-server/issues/30', repository: { nameWithOwner: 'maddec01/lar-server' } })]);
  const response = await startBuild(board, board.id(30, 'maddec01/lar-server'));
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
  const refused = await startBuild(board, board.id(12));
  assert.equal(refused.status, 409);
  assert.equal((await refused.json()).error, 'Blocked by #5 until it closes; use Start after to start it then.');
  assert.deepEqual([...await writes(board), ...await board.t3Calls()], []);
  await board.update({ items: [blocked('CLOSED')] });
  await board.post({}, board.url, '/api/read');
  await until(board, (d) => d.items[0]?.blockers[0]?.state === 'closed');
  assert.equal((await startBuild(board, board.id(12))).status, 200);
});

test("a started build shows in the board data's started builds, apart from the item's refining thread", async (t) => {
  const { board } = await buildBoard(t, [readyIssue(12, ['build'])]);
  const answer = await (await startBuild(board, board.id(12))).json();
  assert.equal(answer.board.startedBuilds[board.id(12)].threadId, 'thread-1');
  assert.equal(answer.board.started?.[board.id(12)], undefined);
});

test('a double press, a retry or another page starts no second build thread', async (t) => {
  const { board } = await buildBoard(t, [readyIssue(12, ['build'])], { t3: { delay: 100 } });
  const responses = await Promise.all([startBuild(board, board.id(12)), startBuild(board, board.id(12))]);
  assert.deepEqual(responses.map((r) => r.status), [200, 200]);
  assert.equal((await startBuild(board, board.id(12))).status, 200);
  assert.equal((await board.t3Calls()).length, 1);
});

for (const fail of ['killed', 'garbage']) {
  test(`an unconfirmed build start (${fail}) is never retried as a new thread`, async (t) => {
    const { board } = await buildBoard(t, [readyIssue(12, ['build'])], { t3: { fail } });
    assert.equal((await (await startBuild(board, board.id(12))).json()).uncertain, true);
    assert.equal((await (await startBuild(board, board.id(12))).json()).uncertain, true);
    assert.equal((await board.t3Calls()).filter(args => args[0] === 'thread' && args[1] === 'start').length, 1);
  });
}

test('Start build only runs for Ready issues from this board page and session', async (t) => {
  const { board } = await buildBoard(t, [boardIssue(12, 'Queued')]);
  assert.match((await (await startBuild(board, board.id(12))).json()).error, /^Only Ready items can start a build; this one is in Queued\.$/);
  assert.equal((await startBuild(board, 'I_missing')).status, 404);
  const restarted = await board.post({ session: 'old', itemId: board.id(12) }, board.url, '/api/start-build');
  assert.equal(restarted.status, 409);
  assert.match((await restarted.json()).error, /Press Start build again/);
  assert.equal((await startBuild(board, board.id(12), undefined, 'https://evil.example')).status, 403);
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
