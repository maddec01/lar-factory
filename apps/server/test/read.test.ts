import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vite-plus/test';
import { changeRecords, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';
import { boardIssue } from '@lar-factory/shared/test/raw-items';

/** The project item reads the board has started, one per read of GitHub. */
async function reads(board: Board): Promise<number> {
  return (await board.calls()).filter((args) => args.some((a) => a.includes('states: [OPEN]'))).length;
}

/** Polls `check` until it passes. The test's deadline bounds the wait, as a loaded board can take seconds to read. */
async function waitFor(check: () => Promise<boolean>): Promise<void> {
  while (!(await check())) await new Promise((r) => setTimeout(r, 25));
}

/** Waits for the board's first read to land and settle, so no read it asks for itself is still to come. */
const firstRead = (board: Board) => until(board, (d) => d.fetchedAt !== null && d.firstRead.settled);

/** A path the fake gh's readHold watches: while the file exists, a read of open issues waits. */
async function holdPath(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar-read-hold-'));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'hold');
}

/** A read request addressed to another host; fetch can't set Host. */
async function askForeignHost(board: Board): Promise<number> {
  const req = request(`${board.url}/api/read`, { method: 'POST',
    headers: { Host: 'evil.example', Origin: 'http://evil.example', 'Content-Type': 'application/json' } });
  req.end('{}');
  const [res] = await once(req, 'response') as [IncomingMessage];
  res.resume();
  return res.statusCode!;
}

const askRead = (board: Board, headers: Record<string, string> = {}) => fetch(`${board.url}/api/read`, { method: 'POST',
  headers: { Origin: board.url, 'Content-Type': 'application/json', ...headers }, body: '{}' });

test("a dossier's map and every item's blockers reach the page; only the bodies of concepts and items with sub-issues on the board are read", async (t) => {
  const body = '## Destination\nThere.\n\n## End-to-end check\nTry it\n1. Step\n';
  const concept = boardIssue(1, 'Shaping', 'maddec01/lar-server', ['concept']);
  const feature = boardIssue(2, 'List', 'maddec01/lar-server', ['feature']);
  const coupled = boardIssue(3, 'In progress', 'maddec01/lar-server', ['feature']);
  const part = boardIssue(4, 'Ready', 'maddec01/lar-server', ['build']);
  Object.assign(concept.content!, { id: 'I_1', body });
  // A ticket's provider blocker never reaches the page; the record's blocker does.
  Object.assign(feature.content!, { id: 'I_2', body, blockedBy: { nodes: [{ number: 3, state: 'OPEN', repository: { nameWithOwner: 'maddec01/lar-server' } }] } });
  Object.assign(coupled.content!, { id: 'I_3', body });
  Object.assign(part.content!, { id: 'I_4', body,
    parent: { number: 3, title: 'Issue 3', url: 'https://github.com/maddec01/lar-server/issues/3', state: 'OPEN', repository: { nameWithOwner: 'maddec01/lar-server' } } });
  const board = await startBoard(t, { repositories: ['maddec01/lar-server'], items: [concept, feature, coupled, part] });
  await firstRead(board);
  const [conceptId, featureId] = [board.id(1, 'maddec01/lar-server'), board.id(2, 'maddec01/lar-server')];
  const shown = await changeRecords(board, (records) => records.addBlocker(featureId, records.read(featureId).revision, conceptId),
    featureId, (item) => item.blockers.length > 0);
  const [map, plain, parent, child] = shown.items;
  const read = { destination: 'There.', decisions: [], fog: [], check: { title: 'Try it', steps: ['Step'] } };
  assert.deepEqual(map?.map, read);
  assert.deepEqual(parent?.map, read, 'an item with a sub-issue on the board is a dossier, with its map');
  assert.deepEqual(map?.blockers, []);
  assert.deepEqual(plain?.blockers, [{ number: 1, repo: 'maddec01/lar-server', state: 'open', workId: conceptId, title: 'Issue 1' }]);
  assert.ok(!('map' in plain!) && !('body' in plain!), 'a feature gets no map and no body');
  assert.ok(!('map' in child!) && !('body' in child!), 'nor does a part');
  const bodyReads = (await board.calls()).filter((args) => args.some((a) => a.includes('nodes(ids:') && a.includes('id body }')));
  assert.equal(bodyReads.filter((args) => args.some((a) => a.includes('id body }'))).length, 1, "one query reads the dossiers' bodies");
  assert.deepEqual(bodyReads[0]!.filter((a) => a.startsWith('ids[]=')), ['ids[]=I_1', 'ids[]=I_3'], 'it asks for the concept and the parent only');
});

test('a read request starts a read of GitHub at once', async (t) => {
  const board = await startBoard(t, { repositories: ['maddec01/lar-factory'], items: [boardIssue(1, 'List')] });
  await firstRead(board);
  const before = await reads(board);
  assert.equal((await askRead(board)).status, 202);
  await waitFor(async () => await reads(board) === before + 1);
});

test('requests during a read queue one more read after it, never two at once', async (t) => {
  const hold = await holdPath(t);
  const board = await startBoard(t, { repositories: ['maddec01/lar-factory'], items: [boardIssue(1, 'List')], readDelay: 300, readHold: hold });
  await firstRead(board);
  const before = await reads(board);
  await writeFile(hold, '');
  assert.equal((await askRead(board)).status, 202);
  // The requested read waits on the hold, so every request below lands during it.
  await board.untilCalled((args) => args[0] === 'held');
  for (let ask = 0; ask < 3; ask++) assert.equal((await askRead(board)).status, 202);
  await rm(hold);
  await waitFor(async () => await reads(board) === before + 2);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await reads(board), before + 2, 'several requests during one read lead to a single extra read');
  assert.equal((await board.calls()).filter((args) => args[0] === 'overlap').length, 0, 'two reads never run together');
});

test('an interval read during a read is skipped, not queued', async (t) => {
  const hold = await holdPath(t);
  const board = await startBoard(t, { repositories: ['maddec01/lar-factory'], items: [boardIssue(1, 'List')], readHold: hold }, false, true,
    { FAST_REFRESH_MS: '1000', FAST_REFRESH_TICKS: '1' });
  await firstRead(board);
  await writeFile(hold, '');
  await board.untilCalled((args) => args[0] === 'held');
  const isRead = (args: string[]) => args.some((a) => a.includes('states: [OPEN]'));
  const isTick = (args: string[]) => args[0] === 'tick';
  /** The calls after the first `marker` entry. */
  const after = async (marker: string) => { const calls = await board.calls(); return calls.slice(calls.findIndex((args) => args[0] === marker) + 1); };
  // Two ticks land while the interval read waits on the hold.
  await waitFor(async () => (await after('held')).filter(isTick).length >= 2);
  await rm(hold);
  await board.untilCalled((args) => args[0] === 'released');
  await waitFor(async () => (await after('released')).some(isRead));
  const held = await after('held');
  const during = held.slice(0, held.findIndex((args) => args[0] === 'released'));
  assert.ok(during.filter(isTick).length >= 2);
  assert.deepEqual(during.filter(isRead), [], 'the ticks during the read start no read');
  const next = await after('released');
  const tick = next.findIndex(isTick);
  assert.ok(tick >= 0 && tick < next.findIndex(isRead), 'the next read waits for a tick instead of starting as the held read ends');
});

test('a read request without JSON, from another origin or to another host reads nothing', async (t) => {
  const board = await startBoard(t, { repositories: ['maddec01/lar-factory'], items: [boardIssue(1, 'List')] });
  await firstRead(board);
  const before = await reads(board);
  assert.equal((await fetch(`${board.url}/api/read`, { method: 'POST', headers: { Origin: board.url }, body: '{}' })).status, 415);
  assert.equal((await askRead(board, { 'Content-Type': 'text/plain' })).status, 415);
  for (const origin of ['https://evil.example', 'null']) assert.equal((await askRead(board, { Origin: origin })).status, 403);
  assert.equal(await askForeignHost(board), 421);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await reads(board), before);
});

test('the sample board answers a read request and reads nothing', async (t) => {
  const board = await startBoard(t, { repositories: ['maddec01/lar-factory'],}, true);
  assert.equal((await askRead(board)).status, 200);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await board.calls()).length, 0);
});

test("a read request naming an item reads that item alone, without loading the configs again", async (t) => {
  const board = await startBoard(t, { repositories: ['maddec01/lar-factory'], items: [boardIssue(1, 'Queued')] });
  await firstRead(board);
  const [item] = (await board.board()).items;
  const configReads = async () => (await board.calls()).filter((args) => args.some((a) => a.endsWith('/.lar-factory.json'))).length;
  const [readsBefore, configsBefore] = [await reads(board), await configReads()];
  await new Promise((r) => setTimeout(r, 2_000));
  assert.equal((await fetch(`${board.url}/api/read`, { method: 'POST', headers: { Origin: board.url, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: item!.url }) })).status, 202);
  const itemReads = async () => (await board.calls()).filter((args) => args.some((a) => a.includes('nodes(ids:') && a.includes('subIssues('))).length;
  await waitFor(async () => await itemReads() === 1);
  assert.equal(await reads(board), readsBefore, 'the repository is not read whole');
  assert.equal(await configReads(), configsBefore);
  assert.equal((await askRead(board)).status, 202);
  await waitFor(async () => await configReads() > configsBefore);
});
