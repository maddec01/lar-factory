import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
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

/** lar-apple's .lar-factory.json naming its issues, for the fake gh; the other repositories read the lar Project. */
const repoConfigs = { [APPLE]: { role: 'Apple client', itemSource: { kind: 'issues' } } };

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
  const board = await startBoard(t, { items: [projectIssue(1, 'In progress', 'maddec01/lar-server'), projectIssue(7, 'Queued', APPLE)], repoIssues, repoConfigs });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(data.items.map((i) => [i.repo, i.number, i.status]),
    [['maddec01/lar-server', 1, 'In progress'], [APPLE, 7, 'Queued'], [APPLE, 8, 'List'], [APPLE, 13, 'Shaping'], [APPLE, 9, 'Done']]);
  assert.equal(data.project.title, 'lar');
  assert.ok(!(await board.calls()).some((args) => args.some((a) => a.includes('repository(owner:')) && args.includes('name=lar-server')),
    'a repository on the Project reads no issues');
});

/** A board reading lar-apple's issues, with the Project's items and options for the fake gh. */
async function issuesBoard(t: TestContext, options: { items?: object[]; repoIssues?: object; fail?: string } = {}, env: Record<string, string> = {}) {
  const items = options.items ?? [];
  const repoIssues = options.repoIssues ?? { [APPLE]: [appleIssue(8)] };
  const board = await startBoard(t, { ...options, items, repoIssues, repoConfigs }, false, false, env);
  await until(board, (d) => d.fetchedAt !== null);
  return board;
}

const projectCommands = async (board: Board) => (await board.calls()).filter((args) => args[0] === 'project');

const labelEdits = async (board: Board) => (await board.calls()).filter((args) => args[0] === 'label' || (args[0] === 'issue' && args[1] === 'edit'));

test("Queue on an item from a repository's issues creates the missing label, swaps it in and reaches no Project", async (t) => {
  const board = await issuesBoard(t, { repoIssues: { [APPLE]: [appleIssue(8, { labels: { nodes: [{ name: 'status-list' }] } })] } });
  const response = await board.post({ itemId: 'I_8' }, board.url, '/api/queue');
  assert.equal(response.status, 200);
  assert.deepEqual(await labelEdits(board), [
    ['label', 'create', '-R', APPLE, '--color', 'EDEDED', '--description', 'Status: Queued', '--', 'status-queued'],
    ['issue', 'edit', '8', '-R', APPLE, '--add-label', 'status-queued', '--remove-label', 'status-list'],
  ]);
  assert.equal((await board.board() as BoardData).items[0]!.status, 'Queued');
  assert.deepEqual(await projectCommands(board), []);
});

for (const [name, fail, error] of [
  ['label creation', 'label-create', `Could not create the status-queued label in ${APPLE}. gh label create failed: HTTP 403: Must have admin rights to Repository.`],
  ['label edit', 'label', 'Could not set Queued. gh issue edit failed: HTTP 403: Resource not accessible by integration'],
] as const) {
  test(`a failed ${name} on a repository's issue shows the error and leaves the item where it was`, async (t) => {
    const board = await issuesBoard(t, { fail });
    const response = await board.post({ itemId: 'I_8' }, board.url, '/api/queue');
    assert.equal(response.status, 502);
    assert.equal((await response.json() as { error: string }).error, error);
    assert.equal((await board.board() as BoardData).items[0]!.status, 'List');
  });
}

test('a move on an issue with two status labels is refused before any write', async (t) => {
  const twice = appleIssue(8, { labels: { nodes: [{ name: 'status-list' }, { name: 'status-ready' }] } });
  const board = await issuesBoard(t, { repoIssues: { [APPLE]: [twice] } });
  const response = await board.post({ itemId: 'I_8' }, board.url, '/api/queue');
  assert.equal(response.status, 409);
  assert.match((await response.json() as { error: string }).error, /carries List and Ready\. Keep one/);
  assert.deepEqual(await labelEdits(board), []);
});

test('picking one of the statuses on an issue with two keeps it, removes the other, and nothing else moves the issue', async (t) => {
  const twice = appleIssue(8, { labels: { nodes: [{ name: 'status-review' }, { name: 'status-shaping' }] } });
  const board = await issuesBoard(t, { repoIssues: { [APPLE]: [twice] }, repoLabels: { [APPLE]: ['status-review'] } } as object);
  const pick = (status: unknown) => board.post({ itemId: 'I_8', status }, board.url, '/api/pick-status');
  for (const status of ['Queued', 'Done', 7]) assert.equal((await pick(status)).status, 409, String(status));
  assert.equal((await board.post({ itemId: 'I_8' }, board.url, '/api/queue')).status, 409);
  assert.deepEqual(await labelEdits(board), []);
  const response = await pick('Review');
  assert.equal(response.status, 200);
  assert.deepEqual(await labelEdits(board), [['issue', 'edit', '8', '-R', APPLE, '--add-label', 'status-review', '--remove-label', 'status-shaping']]);
  const shown = (await response.json() as { board: BoardData }).board.items[0]!;
  assert.deepEqual([shown.status, shown.statuses], ['Review', ['Review']]);
  const read = await until(board, (d) => d.items[0]!.statuses.length === 1 && d.items[0]!.status === 'Review');
  assert.equal(read.items.length, 1);
  assert.equal((await pick('Review')).status, 409, 'one status left, nothing to pick');
});

test('a closed issue that kept two status labels is Done, with nothing to pick', async (t) => {
  const closed = appleIssue(8, { state: 'CLOSED', stateReason: 'COMPLETED', closedAt: daysAgo(1), updatedAt: daysAgo(1),
    labels: { nodes: [{ name: 'status-review' }, { name: 'status-shaping' }] } });
  const board = await issuesBoard(t, { repoIssues: { [APPLE]: [closed] } });
  assert.equal((await board.board() as BoardData).items[0]!.status, 'Done');
  assert.equal((await board.post({ itemId: 'I_8', status: 'Review' }, board.url, '/api/pick-status')).status, 409);
  assert.deepEqual(await labelEdits(board), []);
});

test("Add item in a repository reading its issues creates the issue with status-list and nothing else, and shows it as List", async (t) => {
  const board = await issuesBoard(t);
  const draft = { repo: APPLE, kind: 'feature', title: 'Capture an item', description: '', labels: [] };
  const response = await board.postSession({ requestId: randomUUID(), draft }, '/api/items');
  assert.equal(response.status, 200);
  const result = await response.json() as { item: { status: string; url: string }; error: string | null };
  assert.equal(result.error, null);
  assert.equal(result.item.status, 'List');
  assert.equal(result.item.url, `https://github.com/${APPLE}/issues/900001`);
  const creations = (await board.calls()).filter((args) => args[0] === 'api' && args[1] === '--method');
  assert.deepEqual(creations.map((args) => args.filter((a) => a.startsWith('labels[]='))), [['labels[]=feature', 'labels[]=status-list']]);
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

test("Start build moves a parent from a repository's issues to In progress by its label, on the board or off it", async (t) => {
  const parent = { ...sliceRef(8, 'OPEN'), url: `https://github.com/${APPLE}/issues/8`, repository: { nameWithOwner: APPLE } };
  const offBoardParent = { ...parent, number: 20, url: `https://github.com/${APPLE}/issues/20` };
  const board = await issuesBoard(t, {
    items: [rawIssue('PVTI_12', 12, 'Ready', ['feature'], { parent }), rawIssue('PVTI_13', 13, 'Ready', ['feature'], { parent: offBoardParent })],
    issues: { [`${APPLE}/issues/20`]: { labels: [{ name: 'concept' }, { name: 'status-ready' }] } },
    repoLabels: { [APPLE]: ['status-in-progress'] },
  } as object, startableEnv(t));
  for (const id of ['I_12', 'I_13']) assert.equal((await board.postSession({ itemId: id }, '/api/start-build')).status, 200);
  assert.deepEqual((await labelEdits(board)).filter((args) => args[2] !== '12' && args[2] !== '13'), [
    ['issue', 'edit', '8', '-R', APPLE, '--add-label', 'status-in-progress'],
    ['issue', 'edit', '20', '-R', APPLE, '--add-label', 'status-in-progress', '--remove-label', 'status-ready'],
  ]);
  assert.deepEqual(await projectCommands(board), []);
});
