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

/** A lar-apple issue closed as completed `days` ago. */
const closedIssue = (number: number, days: number, extra: object = {}) =>
  appleIssue(number, { state: 'CLOSED', stateReason: 'COMPLETED', closedAt: daysAgo(days), updatedAt: daysAgo(days), ...extra });

/** A lar-apple issue as a parent or sub-issue reference. */
const appleRef = (number: number, state: 'OPEN' | 'CLOSED') =>
  ({ ...sliceRef(number, state), url: `https://github.com/${APPLE}/issues/${number}`, repository: { nameWithOwner: APPLE } });

/** The node ids the board read in full by id, across every call. */
const readInFull = async (board: Board) => (await board.calls())
  .filter((args) => args.some((a) => a.includes('nodes(ids:') && a.includes('subIssues(')))
  .flatMap((args) => args.filter((a) => a.startsWith('ids[]=')).map((a) => a.slice('ids[]='.length)));

test("closed issues are paged light and only the kept ones read in full: a closed slice of a build never is, a closed sub-issue of a concept is", async (t) => {
  const repoIssues = { [APPLE]: [
    appleIssue(8, { labels: { nodes: [{ name: 'build' }] }, subIssues: { nodes: [appleRef(30, 'CLOSED')] } }),
    closedIssue(30, 1, { parent: appleRef(8, 'OPEN') }),
    appleIssue(20, { labels: { nodes: [{ name: 'concept' }] } }),
    closedIssue(21, 1, { parent: appleRef(20, 'OPEN') }),
    closedIssue(22, 1),
    closedIssue(60, 20, { labels: { nodes: [{ name: 'build' }] } }),
    closedIssue(23, 1, { parent: appleRef(60, 'CLOSED') }),
    closedIssue(24, 1, { stateReason: 'NOT_PLANNED' }),
  ] };
  const board = await startBoard(t, { repoIssues, repoConfigs });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(data.items.map((i) => [i.number, i.status]), [[8, 'List'], [20, 'List'], [21, 'Done'], [22, 'Done'], [23, 'Done']]);
  assert.deepEqual((await readInFull(board)).sort(), ['I_21', 'I_22', 'I_23'], 'a slice whose build was not read stays; one closed as not planned is never read');
  const closedPages = (await board.calls()).filter((args) => args.some((a) => a.includes('states: [CLOSED]') || a.includes('is:closed')));
  assert.ok(closedPages.length > 0 && closedPages.every((args) => !args.some((a) => a.includes('subIssues('))), 'closed pages read no sub-issues');
});

test("closed issues are searched in close-date ranges at once, and one the search doesn't list yet shows from the issues updated last", async (t) => {
  const repoIssues = { [APPLE]: [closedIssue(22, 1), closedIssue(25, 3.5), closedIssue(26, 6.9), closedIssue(27, 0.001), closedIssue(28, 8)] };
  const board = await startBoard(t, { repoIssues, repoConfigs, unindexed: ['I_27'] });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(data.items.map((i) => [i.number, i.status]).sort(), [[22, 'Done'], [25, 'Done'], [26, 'Done'], [27, 'Done']]);
  const ranges = (await board.calls()).flatMap((args) => args.filter((a) => a.startsWith('q=') && a.includes('is:closed')).map((a) => /closed:(\S+)/.exec(a)![1]));
  assert.equal(new Set(ranges).size, 10, 'one search per tenth of the week');
  const recent = (await board.calls()).filter((args) => args.some((a) => a.includes('states: [CLOSED]')));
  assert.equal(recent.length, 1, 'one page of the closed issues updated last, never paged');
  assert.ok(recent[0]!.some((a) => a.includes('UPDATED_AT')));
});

/** How many closed-range searches and pages of the closed issues updated last the board has run. */
const closedReads = async (board: Board) => {
  const calls = await board.calls();
  return { ranges: calls.filter((args) => args.some((a) => a.startsWith('q=') && a.includes('is:closed'))).length,
    pages: calls.filter((args) => args.some((a) => a.includes('states: [CLOSED]'))).length };
};

/** Waits for the board's reads to run at least `count` of the closed reads of that kind, and gives them all. */
async function untilClosed(board: Board, kind: 'ranges' | 'pages', count: number) {
  for (let attempt = 0; attempt < 200 && (await closedReads(board))[kind] < count; attempt++) await new Promise((r) => setTimeout(r, 25));
  return closedReads(board);
}

test('after the first read, a whole read searches the close-date ranges only when the page of closed issues updated last is full', async (t) => {
  const few = await startBoard(t, { repoIssues: { [APPLE]: [closedIssue(22, 1), closedIssue(25, 3)] }, repoConfigs }, false, true);
  const read = await untilClosed(few, 'pages', 3);
  assert.ok(read.pages >= 3, 'the board read whole again');
  assert.equal(read.ranges, 10, 'only the first read searched the ranges');
  assert.deepEqual((await few.board() as BoardData).items.map((i) => i.number).sort(), [22, 25]);

  const full = await startBoard(t, { repoIssues: { [APPLE]: Array.from({ length: 100 }, (_, i) => closedIssue(100 + i, 1)) }, repoConfigs }, false, true);
  assert.ok((await untilClosed(full, 'ranges', 20)).ranges >= 20, 'a full page might miss some, so a later read searches the ranges again');
});

test('the kept closed issues are read in full in calls of at most 25 issues', async (t) => {
  const repoIssues = { [APPLE]: Array.from({ length: 30 }, (_, i) => closedIssue(100 + i, 1)) };
  const board = await startBoard(t, { repoIssues, repoConfigs });
  await until(board, (d) => d.fetchedAt !== null);
  const calls = (await board.calls()).filter((args) => args.some((a) => a.includes('nodes(ids:') && a.includes('subIssues(')));
  assert.deepEqual(calls.map((args) => args.filter((a) => a.startsWith('ids[]=')).length).sort((a, b) => b - a), [25, 5]);
});

test('a repository read runs each label search once, one repository a search', async (t) => {
  const serverRef = { ...sliceRef(70, 'OPEN'), url: 'https://github.com/maddec01/lar-server/issues/70', repository: { nameWithOwner: 'maddec01/lar-server' } };
  const repoIssues = { [APPLE]: [
    appleIssue(8, { labels: { nodes: [{ name: 'build' }] }, subIssues: { nodes: [appleRef(11, 'OPEN'), serverRef] } }),
    closedIssue(50, 1, { labels: { nodes: [{ name: 'build' }] }, subIssues: { nodes: [appleRef(51, 'OPEN')] } }),
  ] };
  const board = await startBoard(t, { repoIssues, repoConfigs });
  await until(board, (d) => d.fetchedAt !== null);
  const searches = (await board.calls()).flatMap((args) => args.filter((a) => a.startsWith('q=') && !a.includes('is:closed')));
  assert.deepEqual([...searches].sort(), [...new Set(searches)].sort(), 'no search runs twice');
  assert.ok(searches.every((q) => q.match(/repo:/g)?.length === 1), 'one repository a search');
  assert.deepEqual(searches.filter((q) => q.includes('label:active')).sort(),
    [`q=is:issue is:open label:active repo:${APPLE}`, 'q=is:issue is:open label:active repo:maddec01/lar-server']);
});

test("open and kept closed issues normalize together: a closed dossier keeps its map, and an open slice of a closed build has no card", async (t) => {
  const body = '## Destination\nThere.\n';
  const repoIssues = { [APPLE]: [
    closedIssue(40, 1, { body }),
    appleIssue(41, { parent: appleRef(40, 'CLOSED') }),
    closedIssue(50, 1, { labels: { nodes: [{ name: 'build' }] }, subIssues: { nodes: [appleRef(51, 'OPEN')] } }),
    appleIssue(51, { parent: appleRef(50, 'CLOSED') }),
  ] };
  const board = await startBoard(t, { repoIssues, repoConfigs });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(data.items.map((i) => i.number), [41, 40, 50]);
  assert.equal(data.items.find((i) => i.number === 40)!.map?.destination, 'There.');
  assert.deepEqual(data.items.find((i) => i.number === 50)!.slices.map((s) => s.number), [51]);
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

test("Abandon on an item from a repository's issues closes it as not planned; without write access it shows gh's error and keeps the item", async (t) => {
  const deleted = await issuesBoard(t, { repoIssues: { [APPLE]: [appleIssue(8), appleIssue(9)] } });
  const response = await deleted.postSession({ itemId: 'I_8' }, '/api/abandon');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { board: BoardData }).board.items.map((i) => i.number), [9]);
  assert.deepEqual((await deleted.calls()).filter((args) => args[1] === 'close'), [['issue', 'close', '8', '-R', APPLE, '--reason', 'not planned']]);
  assert.deepEqual(await projectCommands(deleted), []);

  const kept = await issuesBoard(t, { fail: 'abandon' });
  const refused = await kept.postSession({ itemId: 'I_8' }, '/api/abandon');
  assert.equal(refused.status, 502);
  assert.match((await refused.json() as { error: string }).error, /^Could not abandon #8\. .*write access/);
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
