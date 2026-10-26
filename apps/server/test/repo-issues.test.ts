import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoardData } from '@lar-factory/shared';
import { randomUUID } from 'node:crypto';
import { projectIssue, rawIssue, sliceRef } from '@lar-factory/shared/test/raw-items';
import { startableEnv, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

const APPLE = 'maddec01/lar-apple';
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/** A lar-apple issue as the repository issues query returns it. */
const appleIssue = (number: number, extra: object = {}) => ({ ...projectIssue(number, 'List', APPLE).content!, ...extra });

/** The checkout's config.json with lar-apple reading its issues. */
async function issuesConfig(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar-issues-config-'));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const config = JSON.parse(await readFile(new URL('../../../config.json', import.meta.url), 'utf8')) as { repos: { repo: string }[] };
  for (const entry of config.repos) if (entry.repo === APPLE) Object.assign(entry, { items: 'issues' });
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify(config));
  return file;
}

test("a repository reading its issues places the open ones by their status labels, shows those closed this week as Done and hides those not planned, without slices; the Project's copy wins", async (t) => {
  const build = appleIssue(8, { labels: { nodes: [{ name: 'build' }] }, subIssues: { nodes: [{ ...sliceRef(11, 'OPEN'), repository: { nameWithOwner: APPLE },
    url: `https://github.com/${APPLE}/issues/11` }] } });
  const repoIssues = { [APPLE]: [
    appleIssue(7), build, appleIssue(11),
    appleIssue(9, { state: 'CLOSED', stateReason: 'COMPLETED', closedAt: daysAgo(2), updatedAt: daysAgo(2) }),
    appleIssue(10, { state: 'CLOSED', stateReason: 'COMPLETED', closedAt: daysAgo(10), updatedAt: daysAgo(1) }),
    appleIssue(12, { state: 'CLOSED', stateReason: 'COMPLETED', closedAt: daysAgo(20), updatedAt: daysAgo(20) }),
    appleIssue(13, { labels: { nodes: [{ name: 'status-shaping' }] } }),
    appleIssue(14, { state: 'CLOSED', stateReason: 'NOT_PLANNED', closedAt: daysAgo(1), updatedAt: daysAgo(1) }),
  ] };
  const board = await startBoard(t, { items: [projectIssue(1, 'In progress', 'maddec01/lar-server'), projectIssue(7, 'Queued', APPLE)], repoIssues },
    false, false, { BOARD_CONFIG_FILE: await issuesConfig(t) });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(data.items.map((i) => [i.repo, i.number, i.status]),
    [['maddec01/lar-server', 1, 'In progress'], [APPLE, 7, 'Queued'], [APPLE, 8, 'List'], [APPLE, 13, 'Shaping'], [APPLE, 9, 'Done']]);
  assert.equal(data.project.title, 'lar');
  assert.ok(!(await board.calls()).some((args) => args.some((a) => a.includes('repository(owner:')) && args.includes('name=lar-server')),
    'a repository on the Project reads no issues');
});

const STATUS_LABELS = "Moving an issue from a repository's issues needs status labels, which come in build #379.";

/** A board reading lar-apple's issues, with the Project's items and options for the fake gh. */
async function issuesBoard(t: TestContext, options: { items?: object[]; repoIssues?: object; fail?: string } = {}, env: Record<string, string> = {}) {
  const items = options.items ?? [];
  const repoIssues = options.repoIssues ?? { [APPLE]: [appleIssue(8)] };
  const board = await startBoard(t, { ...options, items, repoIssues }, false, false, { ...env, BOARD_CONFIG_FILE: await issuesConfig(t) });
  await until(board, (d) => d.fetchedAt !== null);
  return board;
}

const projectCommands = async (board: Board) => (await board.calls()).filter((args) => args[0] === 'project');

test("Queue on an item from a repository's issues is refused until status labels come, and reaches no Project", async (t) => {
  const board = await issuesBoard(t);
  const response = await board.post({ itemId: 'I_8' }, board.url, '/api/queue');
  assert.equal(response.status, 409);
  assert.equal((await response.json() as { error: string }).error, STATUS_LABELS);
  assert.equal((await board.board() as BoardData).items[0]!.status, 'List');
  assert.deepEqual(await projectCommands(board), []);
});

test("Add item in a repository reading its issues creates the issue and nothing else, and shows it as List", async (t) => {
  const board = await issuesBoard(t);
  const draft = { repo: APPLE, kind: 'feature', title: 'Capture an item', description: '', labels: [] };
  const response = await board.postSession({ requestId: randomUUID(), draft }, '/api/items');
  assert.equal(response.status, 200);
  const result = await response.json() as { item: { status: string; url: string }; error: string | null };
  assert.equal(result.error, null);
  assert.equal(result.item.status, 'List');
  assert.equal(result.item.url, `https://github.com/${APPLE}/issues/900001`);
  assert.equal((await board.calls()).filter((args) => args[0] === 'api' && args[1] === '--method').length, 1);
  assert.deepEqual(await projectCommands(board), []);
});

test("Abandon on an item from a repository's issues deletes the issue; without admin rights it shows gh's error and keeps the item", async (t) => {
  const deleted = await issuesBoard(t, { repoIssues: { [APPLE]: [appleIssue(8), appleIssue(9)] } });
  const response = await deleted.postSession({ itemId: 'I_8' }, '/api/abandon');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { board: BoardData }).board.items.map((i) => i.number), [9]);
  assert.deepEqual((await deleted.calls()).filter((args) => args[1] === 'delete'), [['issue', 'delete', '8', '-R', APPLE, '--yes']]);
  assert.deepEqual(await projectCommands(deleted), []);

  const kept = await issuesBoard(t, { fail: 'delete' });
  const refused = await kept.postSession({ itemId: 'I_8' }, '/api/abandon');
  assert.equal(refused.status, 502);
  assert.match((await refused.json() as { error: string }).error, /^Could not delete #8\. .*admin rights/);
  assert.equal((await kept.board() as BoardData).items.length, 1);
});

test("Start build on an item whose parent comes from a repository's issues is refused before any write", async (t) => {
  const parent = { ...sliceRef(8, 'OPEN'), url: `https://github.com/${APPLE}/issues/8`, repository: { nameWithOwner: APPLE } };
  const offBoardParent = { ...parent, number: 20, url: `https://github.com/${APPLE}/issues/20` };
  const board = await issuesBoard(t, {
    items: [rawIssue('PVTI_12', 12, 'Ready', ['feature'], { parent }), rawIssue('PVTI_13', 13, 'Ready', ['feature'], { parent: offBoardParent })],
    issues: { [`${APPLE}/issues/20`]: { labels: [{ name: 'concept' }] } },
  } as object, startableEnv(t));
  for (const id of ['I_12', 'I_13']) {
    const response = await board.postSession({ itemId: id }, '/api/start-build');
    assert.equal(response.status, 409);
    assert.equal((await response.json() as { error: string }).error, STATUS_LABELS);
  }
  const calls = await board.calls();
  assert.ok(!calls.some((args) => args[0] === 'issue' && args[1] === 'edit'), 'no label was added');
  assert.deepEqual(await projectCommands(board), []);
  assert.deepEqual(await board.t3Calls(), []);
});
