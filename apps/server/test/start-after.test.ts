import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NOT_LANDED, SAMPLE_MODELS, startableEnv, startBoard, until, writeOnboarding } from './server-support.ts';
import type { Board } from './server-support.ts';
import { rawIssue } from '@lar-factory/shared/test/raw-items';
import type { BoardData, RawItem } from '@lar-factory/shared';

const OPUS = { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5' };

/** A lar-factory issue in `status`, blocked by issues 5 and 6 in the given states. */
const blockedIssue = (number: number, status: string, labels: string[], states: ['OPEN' | 'CLOSED', 'OPEN' | 'CLOSED']): RawItem =>
  rawIssue(`PVTI_${number}`, number, status, labels, {
    blockedBy: { nodes: states.map((state, n) => ({ number: 5 + n, state, repository: { nameWithOwner: 'maddec01/lar-factory' } })) },
  });

const blockedBuild = (states: ['OPEN' | 'CLOSED', 'OPEN' | 'CLOSED'] = ['CLOSED', 'OPEN']) => blockedIssue(12, 'Ready', ['build'], states);

/** A board that can start lar-factory threads, offering the sample model choices, and its environment. */
async function armableBoard(t: TestContext, items: RawItem[], options: object = {}, env: Record<string, string> = { ...startableEnv(t), ...SAMPLE_MODELS }) {
  const board = await startBoard(t, { items, ...options }, false, false, env);
  await until(board, (d) => d.items.length === items.length);
  return { board, env };
}

const arm = (board: Board, itemId: string, model?: unknown) => board.postSession({ itemId, model }, '/api/arm');
const disarm = (board: Board, itemId: string) => board.postSession({ itemId }, '/api/disarm');
const armedPath = (home: string) => join(home, 'Library/Application Support/Lar Factory/armed-starts.json');
const armedFile = (home: string) => JSON.parse(readFileSync(armedPath(home), 'utf8'));

/** Asks for a read and waits until it lands. */
async function read(board: Board): Promise<BoardData> {
  const before = (await board.board() as BoardData).fetchedAt;
  await board.post({}, board.url, '/api/read');
  return until(board, (d) => d.fetchedAt !== before);
}

test('arming and disarming write and remove the entry, which the board data carries', async (t) => {
  const { board, env } = await armableBoard(t, [blockedBuild()]);
  const armed = await arm(board, 'I_12', OPUS);
  assert.equal(armed.status, 200);
  assert.deepEqual((await armed.json()).board.armed, { I_12: { model: OPUS } });
  assert.deepEqual(armedFile(env.HOME!), { I_12: { model: OPUS } });
  const disarmed = await disarm(board, 'I_12');
  assert.equal(disarmed.status, 200);
  assert.deepEqual((await disarmed.json()).board.armed, {});
  assert.deepEqual(armedFile(env.HOME!), {});
});

test('armed starts survive a board restart', async (t) => {
  const { board, env } = await armableBoard(t, [blockedBuild()]);
  assert.equal((await arm(board, 'I_12')).status, 200);
  await board.stop();
  const { board: again } = await armableBoard(t, [blockedBuild()], {}, env);
  assert.deepEqual((await again.board() as BoardData).armed, { I_12: {} });
});

test('a refresh with a blocker still open starts nothing; once the last closes, the next starts the build once, on its armed model', async (t) => {
  const { board, env } = await armableBoard(t, [blockedBuild()]);
  assert.equal((await arm(board, 'I_12', OPUS)).status, 200);
  // A start disarms its part before the read's data is served, so a part still armed didn't start.
  assert.deepEqual((await read(board)).armed, { I_12: { model: OPUS } });
  await board.update({ items: [blockedBuild(['CLOSED', 'CLOSED'])] });
  await read(board);
  const started = await until(board, (d) => !!d.startedBuilds?.I_12);
  assert.deepEqual(started.armed, {});
  assert.deepEqual(armedFile(env.HOME!), {});
  await read(board);
  assert.deepEqual((await board.t3Calls()).map((args) => args.slice(0, 3).concat(args.slice(4, 8))), [
    ['thread', 'start', 'project-factory', '--provider', 'claudeAgent_personal', '--model', 'claude-opus-5-5'],
  ]);
  assert.ok((await board.t3Calls())[0]!.includes('--worktree'), 'a build starts in its own worktree');
});

test('a start armed under its Project item id, before items were keyed by node id, moves to the node id on the first read and still fires', async (t) => {
  const env: Record<string, string> = { ...startableEnv(t), ...SAMPLE_MODELS };
  mkdirSync(dirname(armedPath(env.HOME!)), { recursive: true });
  writeFileSync(armedPath(env.HOME!), JSON.stringify({ PVTI_12: { model: OPUS } }));
  const { board } = await armableBoard(t, [blockedBuild()], {}, env);
  const moved = await until(board, (d) => !!d.armed?.I_12);
  assert.deepEqual(moved.armed, { I_12: { model: OPUS } });
  assert.deepEqual(armedFile(env.HOME!), { I_12: { model: OPUS } });
  await board.update({ items: [blockedBuild(['CLOSED', 'CLOSED'])] });
  await read(board);
  await until(board, (d) => !!d.startedBuilds?.I_12);
  assert.deepEqual(armedFile(env.HOME!), {});
});

test("a Queued decision starts with today's Start once its blockers close", async (t) => {
  const decision = (states: ['OPEN' | 'CLOSED', 'OPEN' | 'CLOSED']) => blockedIssue(20, 'Queued', ['decision-grill'], states);
  const { board } = await armableBoard(t, [decision(['OPEN', 'OPEN'])]);
  assert.equal((await arm(board, 'I_20')).status, 200);
  await board.update({ items: [decision(['CLOSED', 'CLOSED'])] });
  await read(board);
  await until(board, (d) => !!d.started?.I_20);
  assert.deepEqual(await board.t3Calls(), [['thread', 'start', 'project-factory', '#20 Issue 20\n$lar-work maddec01/lar-factory#20', '--json']]);
});

test('a failed start disarms the part and shows its error on it, until it is armed again', async (t) => {
  const { board, env } = await armableBoard(t, [blockedBuild()], { t3: { fail: 'down' } });
  assert.equal((await arm(board, 'I_12')).status, 200);
  await board.update({ items: [blockedBuild(['CLOSED', 'CLOSED'])], t3: { fail: 'down' } });
  await read(board);
  const failed = await until(board, (d) => !!d.armedErrors?.I_12);
  assert.deepEqual(failed.armed, {});
  assert.deepEqual(armedFile(env.HOME!), {});
  await board.update({ items: [blockedBuild()], t3: { fail: 'down' } });
  await read(board);
  assert.equal((await (await arm(board, 'I_12')).json()).board.armedErrors.I_12, undefined);
});

test("a part whose repository has no T3 project can't be armed, as its start would fail", async (t) => {
  const server = rawIssue('PVTI_30', 30, 'Ready', ['build'], {
    url: 'https://github.com/maddec01/lar-server/issues/30', repository: { nameWithOwner: 'maddec01/lar-server' },
    blockedBy: { nodes: [{ number: 5, state: 'OPEN', repository: { nameWithOwner: 'maddec01/lar-factory' } }] },
  });
  const { board } = await armableBoard(t, [server]);
  await until(board, (d) => !!d.repositoryProjects);
  const refused = await arm(board, 'I_30');
  assert.equal(refused.status, 409);
  const answer = await refused.json();
  assert.equal(answer.error, 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code');
  assert.deepEqual(answer.board.armed, {});
});

test("a part whose repository is still onboarding can't be armed, and one armed already waits for onboarding's PR", async (t) => {
  const env: Record<string, string> = { ...startableEnv(t), ...SAMPLE_MODELS };
  writeOnboarding(env.HOME!, 'maddec01/lar-factory');
  mkdirSync(dirname(armedPath(env.HOME!)), { recursive: true });
  writeFileSync(armedPath(env.HOME!), JSON.stringify({ I_12: { model: OPUS } }));
  const { board } = await armableBoard(t, [blockedBuild(['CLOSED', 'CLOSED']), blockedIssue(20, 'Queued', [], ['OPEN', 'OPEN'])], NOT_LANDED, env);
  const refused = await arm(board, 'I_20');
  assert.deepEqual([refused.status, (await refused.json()).error], [409, "Waits for onboarding's PR to merge"]);
  const data = await read(board);
  assert.deepEqual([data.armed, data.armedErrors], [{ I_12: { model: OPUS } }, {}]);
  assert.deepEqual(await board.t3Calls(), []);
});

test('an armed start whose repository Reset takes off the board drops on the next read and never starts, also after a restart', async (t) => {
  const { board, env } = await armableBoard(t, [blockedBuild()], { files: ['.lar-factory.json'] });
  assert.equal((await arm(board, 'I_12', OPUS)).status, 200);
  assert.equal((await board.post({ repo: 'maddec01/lar-factory' }, board.url, '/api/onboarding/reset')).status, 200);
  await board.update({ items: [blockedBuild(['CLOSED', 'CLOSED'])] });
  const data = await read(board);
  assert.deepEqual([data.items, data.armed], [[], {}]);
  assert.deepEqual(armedFile(env.HOME!), {});
  await board.stop();
  const again = await startBoard(t, { items: [blockedBuild(['CLOSED', 'CLOSED'])] }, false, false, env);
  assert.deepEqual((await read(again)).items, []);
  assert.deepEqual([await board.t3Calls(), await again.t3Calls()], [[], []]);
});

test('only a blocked Ready or Queued issue, on an offered model, from this page and session, can be armed', async (t) => {
  const { board } = await armableBoard(t, [blockedBuild(), rawIssue('PVTI_13', 13, 'Ready', []),
    blockedIssue(14, 'In progress', [], ['OPEN', 'OPEN'])]);
  assert.match((await (await arm(board, 'I_13')).json()).error, /^Nothing blocks this item now/);
  assert.match((await (await arm(board, 'I_14')).json()).error, /^Only Ready and Queued items can start after their blockers; this one is in In progress\.$/);
  assert.equal((await arm(board, 'I_missing')).status, 404);
  assert.equal((await arm(board, 'I_12', { instanceId: 'codex', model: '--help' })).status, 422);
  const restarted = await board.post({ session: 'old', itemId: 'I_12' }, board.url, '/api/arm');
  assert.equal(restarted.status, 409);
  assert.match((await restarted.json()).error, /Press Start after again/);
  assert.equal((await board.post({ itemId: 'I_12' }, 'https://evil.example', '/api/disarm')).status, 403);
  assert.equal((await board.board() as BoardData).armed?.I_12, undefined);
  const sample = await startBoard(t, {}, true);
  assert.equal((await arm(sample, 'I_sample13')).status, 403);
  assert.equal((await disarm(sample, 'I_sample13')).status, 403);
});
