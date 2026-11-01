import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { BoardData } from '@lar-factory/shared';
import { randomUUID } from 'node:crypto';
import { boardIssue, rawIssue, sliceRef } from '@lar-factory/shared/test/raw-items';
import { startableEnv, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

const APPLE = 'maddec01/lar-apple';
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/** A lar-apple issue as the repository issues query returns it. */
const appleIssue = (number: number, extra: object = {}) => ({ ...boardIssue(number, 'List', APPLE).content!, ...extra });

/** lar-apple's .lar-factory.json naming its issues, for the fake gh. */
const localSetups = { [APPLE]: { role: 'Apple client', itemSource: { kind: 'issues' } } };

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
  const board = await startBoard(t, { repositories: [APPLE], repoIssues, localSetups });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(data.items.map((i) => [i.number, i.status]), [[8, 'List'], [20, 'List'], [21, 'Done'], [22, 'Done'], [23, 'Done']]);
  assert.deepEqual((await readInFull(board)).sort(), ['I_21', 'I_22', 'I_23'], 'a slice whose build was not read stays; one closed as not planned is never read');
  const closedPages = (await board.calls()).filter((args) => args.some((a) => a.includes('states: [CLOSED]') || a.includes('is:closed')));
  assert.ok(closedPages.length > 0 && closedPages.every((args) => !args.some((a) => a.includes('subIssues('))), 'closed pages read no sub-issues');
});

test("closed issues are searched in close-date ranges at once, and one the search doesn't list yet shows from the issues updated last", async (t) => {
  const repoIssues = { [APPLE]: [closedIssue(22, 1), closedIssue(25, 3.5), closedIssue(26, 6.9), closedIssue(27, 0.001), closedIssue(28, 8)] };
  const board = await startBoard(t, { repositories: [APPLE], repoIssues, localSetups, unindexed: ['I_27'] });
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
  await board.untilCalled(args => args.some(arg => kind === 'ranges'
    ? arg.startsWith('q=') && arg.includes('is:closed')
    : arg.includes('states: [CLOSED]')), count);
  return closedReads(board);
}

test('after the first read, a whole read searches the close-date ranges only when the page of closed issues updated last is full', async (t) => {
  const few = await startBoard(t, { repositories: [APPLE], repoIssues: { [APPLE]: [closedIssue(22, 1), closedIssue(25, 3)] }, localSetups }, false, true);
  const read = await untilClosed(few, 'pages', 3);
  assert.ok(read.pages >= 3, 'the board read whole again');
  assert.equal(read.ranges, 10, 'only the first read searched the ranges');
  assert.deepEqual((await few.board() as BoardData).items.map((i) => i.number).sort(), [22, 25]);

  const full = await startBoard(t, { repositories: [APPLE], repoIssues: { [APPLE]: Array.from({ length: 100 }, (_, i) => closedIssue(100 + i, 1)) }, localSetups }, false, true);
  assert.ok((await untilClosed(full, 'ranges', 20)).ranges >= 20, 'a full page might miss some, so a later read searches the ranges again');
});

test('the kept closed issues are read in full in calls of at most 25 issues', async (t) => {
  const repoIssues = { [APPLE]: Array.from({ length: 30 }, (_, i) => closedIssue(100 + i, 1)) };
  const board = await startBoard(t, { repositories: [APPLE], repoIssues, localSetups });
  await until(board, (d) => d.fetchedAt !== null);
  const calls = (await board.calls()).filter((args) => args.some((a) => a.includes('nodes(ids:') && a.includes('subIssues(')));
  assert.deepEqual(calls.map((args) => args.filter((a) => a.startsWith('ids[]=')).length).sort((a, b) => b - a), [25, 5]);
});

test('a repository read runs each build search once, one repository a search, and no slice label search', async (t) => {
  const serverRef = { ...sliceRef(70, 'OPEN'), url: 'https://github.com/maddec01/lar-server/issues/70', repository: { nameWithOwner: 'maddec01/lar-server' } };
  const repoIssues = { [APPLE]: [
    appleIssue(8, { labels: { nodes: [{ name: 'build' }] }, subIssues: { nodes: [appleRef(11, 'OPEN'), serverRef] } }),
    closedIssue(50, 1, { labels: { nodes: [{ name: 'build' }] }, subIssues: { nodes: [appleRef(51, 'OPEN')] } }),
  ] };
  const board = await startBoard(t, { repositories: [APPLE], repoIssues, localSetups });
  await until(board, (d) => d.fetchedAt !== null);
  const searches = (await board.calls()).flatMap((args) => args.filter((a) => a.startsWith('q=') && !a.includes('is:closed')));
  assert.deepEqual([...searches].sort(), [...new Set(searches)].sort(), 'no search runs twice');
  assert.ok(searches.every((q) => q.match(/repo:/g)?.length === 1), 'one repository a search');
  assert.deepEqual(searches.sort(), [`q=is:issue label:build repo:${APPLE}`, 'q=is:issue label:build repo:maddec01/lar-server']);
});

test("open and kept closed issues normalize together: a closed dossier keeps its map, and an open slice of a closed build has no card", async (t) => {
  const body = '## Destination\nThere.\n';
  const repoIssues = { [APPLE]: [
    closedIssue(40, 1, { body }),
    appleIssue(41, { parent: appleRef(40, 'CLOSED') }),
    closedIssue(50, 1, { labels: { nodes: [{ name: 'build' }] }, subIssues: { nodes: [appleRef(51, 'OPEN')] } }),
    appleIssue(51, { parent: appleRef(50, 'CLOSED') }),
  ] };
  const board = await startBoard(t, { repositories: [APPLE], repoIssues, localSetups });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(data.items.map((i) => i.number).sort(), [40, 41, 50]);
  assert.equal(data.items.find((i) => i.number === 40)!.map?.destination, 'There.');
  assert.deepEqual(data.items.find((i) => i.number === 50)!.slices.map((s) => s.number), [51]);
});

/** A board reading lar-apple's issues, with items and options for the fake gh. */
async function issuesBoard(t: TestContext, options: { items?: object[]; repoIssues?: object; fail?: string } = {}, env: Record<string, string> = {}) {
  const items = options.items ?? [];
  const repoIssues = options.repoIssues ?? { [APPLE]: [appleIssue(8)] };
  const board = await startBoard(t, { ...options, items, repoIssues, localSetups }, false, false, env);
  await until(board, (d) => d.fetchedAt !== null);
  return board;
}

const projectCommands = async (board: Board) => (await board.calls()).filter((args) => args[0] === 'project');

const labelEdits = async (board: Board) => (await board.calls()).filter((args) => args[0] === 'label' || (args[0] === 'issue' && args[1] === 'edit'));

test("in a repository with no factory labels or config, Add item records work locally and a picked ticket gets one record", async (t) => {
  const board = await startBoard(t, { repositories: [APPLE], repoIssues: { [APPLE]: [appleIssue(8, { title: 'Seek stalls', labels: { nodes: [] }, body: 'Steps.' })] }, recorded: false });
  await until(board, (d) => d.fetchedAt !== null);
  const draft = { createIssue: false, repo: APPLE, kind: 'feature', title: 'Capture an item', description: '' };
  const captured = await board.postSession({ requestId: randomUUID(), draft }, '/api/items');
  assert.equal(captured.status, 200);
  const { item } = await captured.json() as { item: { id: string; number: number; status: string } };
  assert.deepEqual([item.number, item.status], [0, 'List']);

  const search = await fetch(`${board.url}/api/tickets?repo=${APPLE}&q=seek`);
  assert.deepEqual((await search.json() as { tickets: unknown[] }).tickets, [{ number: 8, title: 'Seek stalls', url: `https://github.com/${APPLE}/issues/8` }]);
  const pick = () => board.postSession({ repo: APPLE, number: 8 }, '/api/pick-ticket');
  const first = await (await pick()).json() as { item: { id: string; number: number; url: string }; board: BoardData };
  assert.deepEqual([first.item.number, first.item.url], [8, `https://github.com/${APPLE}/issues/8`]);
  const again = await (await pick()).json() as { item: { id: string }; board: BoardData };
  assert.equal(again.item.id, first.item.id);
  assert.deepEqual(again.board.items.map((i) => i.number).sort(), [0, 8]);
  const searched = await (await fetch(`${board.url}/api/tickets?repo=${APPLE}&q=seek`)).json() as { tickets: { workId?: string }[] };
  assert.equal(searched.tickets[0]!.workId, first.item.id);
  const writes = (await board.calls()).filter((args) => args[0] === 'label' || (args[0] === 'issue' && !['list', 'view'].includes(args[1]!)) || args.includes('POST'));
  assert.deepEqual(writes, []);
});

test("closing an abandoned item's ticket from a repository's issues closes it as not planned; without write access it shows gh's error", async (t) => {
  const deleted = await issuesBoard(t, { repoIssues: { [APPLE]: [appleIssue(8), appleIssue(9)] } });
  const response = await deleted.postSession({ itemId: deleted.id(8, APPLE) }, '/api/abandon');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { board: BoardData }).board.items.map((i) => i.number), [9]);
  assert.equal((await deleted.postSession({ itemId: deleted.id(8, APPLE) }, '/api/close-ticket')).status, 200);
  assert.deepEqual((await deleted.calls()).filter((args) => args[1] === 'close'), [['issue', 'close', '8', '-R', APPLE, '--reason', 'not planned']]);
  assert.deepEqual(await projectCommands(deleted), []);

  const kept = await issuesBoard(t, { fail: 'abandon' });
  assert.equal((await kept.postSession({ itemId: kept.id(8, APPLE) }, '/api/abandon')).status, 200);
  const refused = await kept.postSession({ itemId: kept.id(8, APPLE) }, '/api/close-ticket');
  assert.equal(refused.status, 502);
  assert.match((await refused.json() as { error: string }).error, /^Could not abandon #8\. .*write access/);
});

