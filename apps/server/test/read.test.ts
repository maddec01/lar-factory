import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { startBoard } from './server-support.ts';
import type { Board } from './server-support.ts';
import { projectIssue } from '@lar-factory/shared/test/raw-items';

/** The project item reads the board has started, one per read of GitHub. */
async function reads(board: Board): Promise<number> {
  return (await board.calls()).filter((args) => args.some((a) => a.includes('projectV2(number'))).length;
}

async function waitFor(check: () => Promise<boolean>, what: string): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timed out waiting for ${what}`);
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
  const concept = projectIssue(1, 'Shaping', 'maddec01/lar-server', ['concept']);
  const feature = projectIssue(2, 'List', 'maddec01/lar-server', ['feature']);
  const coupled = projectIssue(3, 'In progress', 'maddec01/lar-server', ['feature']);
  const part = projectIssue(4, 'Ready', 'maddec01/lar-apple', ['build']);
  Object.assign(concept.content!, { id: 'I_1', body });
  Object.assign(feature.content!, { id: 'I_2', body, blockedBy: { nodes: [{ number: 1, state: 'OPEN', repository: { nameWithOwner: 'maddec01/lar-server' } }] } });
  Object.assign(coupled.content!, { id: 'I_3', body });
  Object.assign(part.content!, { id: 'I_4', body,
    parent: { number: 3, title: 'Issue 3', url: 'https://github.com/maddec01/lar-server/issues/3', state: 'OPEN', repository: { nameWithOwner: 'maddec01/lar-server' } } });
  const board = await startBoard(t, { items: [concept, feature, coupled, part] });
  await waitFor(async () => (await board.board()).fetchedAt !== null, 'the first read');
  const [map, plain, parent, child] = (await board.board()).items;
  const read = { destination: 'There.', decisions: [], fog: [], check: { title: 'Try it', steps: ['Step'] } };
  assert.deepEqual(map?.map, read);
  assert.deepEqual(parent?.map, read, 'an item with a sub-issue on the board is a dossier, with its map');
  assert.deepEqual(map?.blockers, []);
  assert.deepEqual(plain?.blockers, [{ number: 1, repo: 'maddec01/lar-server', state: 'open' }]);
  assert.ok(!('map' in plain!) && !('body' in plain!), 'a feature gets no map and no body');
  assert.ok(!('map' in child!) && !('body' in child!), 'nor does a part');
  const bodyReads = (await board.calls()).filter((args) => args.some((a) => a.includes('nodes(ids:')));
  assert.equal(bodyReads.length, 1, "one query reads the dossiers' bodies");
  assert.deepEqual(bodyReads[0]!.filter((a) => a.startsWith('ids[]=')), ['ids[]=I_1', 'ids[]=I_3'], 'it asks for the concept and the parent only');
});

test('a read request starts a read of GitHub at once', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(1, 'List')] });
  await waitFor(async () => (await board.board()).fetchedAt !== null, 'the first read');
  const before = await reads(board);
  assert.equal((await askRead(board)).status, 202);
  await waitFor(async () => await reads(board) === before + 1, 'the requested read');
});

test('requests during a read queue one more read after it, never two at once', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(1, 'List')], readDelay: 300 });
  await waitFor(async () => (await board.board()).fetchedAt !== null, 'the first read');
  const before = await reads(board);
  assert.equal((await askRead(board)).status, 202);
  await waitFor(async () => await reads(board) === before + 1, 'the requested read');
  for (let ask = 0; ask < 3; ask++) assert.equal((await askRead(board)).status, 202);
  await waitFor(async () => await reads(board) === before + 2, 'the queued read');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(await reads(board), before + 2, 'several requests during one read lead to a single extra read');
  assert.equal((await board.calls()).filter((args) => args[0] === 'overlap').length, 0, 'two reads never run together');
});

test('an interval read during a read is skipped, not queued', async (t) => {
  // Reads take a tick and a half, so the second tick lands during the first interval read.
  const board = await startBoard(t, { items: [projectIssue(1, 'List')], readDelay: 1500 }, false, true, { FAST_REFRESH_MS: '1000' });
  await waitFor(async () => (await board.board()).fetchedAt !== null, 'the first read');
  const before = await reads(board);
  await waitFor(async () => await reads(board) === before + 1, 'the first interval read');
  // A queued read would start as this one ends, about 1.5 s in; the next tick starts one at about 2 s.
  await new Promise((r) => setTimeout(r, 1750));
  assert.equal(await reads(board), before + 1);
});

test('a read request without JSON, from another origin or to another host reads nothing', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(1, 'List')] });
  await waitFor(async () => (await board.board()).fetchedAt !== null, 'the first read');
  const before = await reads(board);
  assert.equal((await fetch(`${board.url}/api/read`, { method: 'POST', headers: { Origin: board.url }, body: '{}' })).status, 415);
  assert.equal((await askRead(board, { 'Content-Type': 'text/plain' })).status, 415);
  for (const origin of ['https://evil.example', 'null']) assert.equal((await askRead(board, { Origin: origin })).status, 403);
  assert.equal(await askForeignHost(board), 421);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await reads(board), before);
});

test('the sample board answers a read request and reads nothing', async (t) => {
  const board = await startBoard(t, {}, true);
  assert.equal((await askRead(board)).status, 200);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await board.calls()).length, 0);
});

test("a read request naming an item reads that item alone, without loading the configs again", async (t) => {
  const board = await startBoard(t, { items: [projectIssue(1, 'Queued')] });
  await waitFor(async () => (await board.board()).fetchedAt !== null, 'the first read');
  const [item] = (await board.board()).items;
  const configReads = async () => (await board.calls()).filter((args) => args.some((a) => a.endsWith('/.lar-factory.json'))).length;
  const [readsBefore, configsBefore] = [await reads(board), await configReads()];
  await new Promise((r) => setTimeout(r, 2_000));
  assert.equal((await fetch(`${board.url}/api/read`, { method: 'POST', headers: { Origin: board.url, 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: item!.url }) })).status, 202);
  const itemReads = async () => (await board.calls()).filter((args) => args.some((a) => a.includes('on ProjectV2Item {'))).length;
  await waitFor(async () => await itemReads() === 1, 'the requested read');
  assert.equal(await reads(board), readsBefore, 'the Project is not read whole');
  assert.equal(await configReads(), configsBefore);
  assert.equal((await askRead(board)).status, 202);
  await waitFor(async () => await configReads() > configsBefore, 'a read request naming nothing loads the configs again');
});
