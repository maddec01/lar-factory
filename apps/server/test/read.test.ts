import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { startBoard } from './server-support.ts';
import type { Board } from './server-support.ts';
import { projectIssue } from '@mux-factory/shared/test/raw-items';

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
