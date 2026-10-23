import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startBoard } from './server-support.ts';

type Board = Awaited<ReturnType<typeof startBoard>>;
const recheck = (board: Board) => board.post({}, board.url, '/api/recheck');

/** The board data once the first read has finished, or failed. */
async function afterRead(board: Board) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const data = await board.board();
    if (data.fetchedAt || data.error) return data;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('The board never finished its first read.');
}

test('Recheck finds a t3 that appeared after startup', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mux-t3-later-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const t3 = join(dir, 't3');
  const board = await startBoard(t, {}, false, false, { T3_PATH: t3 });
  assert.deepEqual((await board.board()).tools, { t3: { problem: 'missing', override: `T3_PATH=${t3}` } });
  copyFileSync(new URL('./fake-t3.cjs', import.meta.url), t3);
  chmodSync(t3, 0o755);
  const response = await recheck(board);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).board.tools, {});
});

test('a logged-out gh shows its notice and reads nothing until Recheck finds it logged in', async (t) => {
  const board = await startBoard(t, { ghAuth: 'logged-out' });
  const data = await board.board();
  assert.deepEqual(data.tools, { gh: { problem: 'logged-out' } });
  assert.equal(data.error, null);
  assert.equal((await board.calls()).filter((args) => args[1] === 'graphql').length, 0);
  await board.update({});
  assert.deepEqual((await (await recheck(board)).json()).board.tools, {});
  assert.ok((await afterRead(board)).fetchedAt, 'the board reads GitHub once gh works');
});

test('a logged-out gh that logs in is found by the timed retry, which keeps the login PATH it read', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'mux-shell-log-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const shellLog = join(dir, 'runs');
  const shellRuns = () => existsSync(shellLog) ? readFileSync(shellLog, 'utf8').trim().split('\n').length : 0;
  const board = await startBoard(t, { ghAuth: 'logged-out' }, false, false, { FAKE_SHELL_LOG: shellLog, BOARD_TOOL_RETRY_MS: '100' });
  assert.deepEqual((await board.board()).tools, { gh: { problem: 'logged-out' } });
  await board.update({});
  assert.ok((await afterRead(board)).fetchedAt, 'the board reads GitHub once a retry finds gh logged in');
  assert.deepEqual((await board.board()).tools, {});
  assert.equal(shellRuns(), 1, 'only startup reads the login shell PATH');
  await recheck(board);
  assert.equal(shellRuns(), 2, 'Recheck reads it again');
});

test('a missing gh names its override', async (t) => {
  const board = await startBoard(t, {}, false, false, { GH_PATH: '/nowhere/gh' });
  assert.deepEqual((await board.board()).tools, { gh: { problem: 'missing', override: 'GH_PATH=/nowhere/gh' } });
  assert.match(board.logs(), /t3 at \S+; gh was not found at GH_PATH=\/nowhere\/gh; az /);
});

test('a failed read whose gh auth status fails without a logout shows gh\'s error as Stale', async (t) => {
  const data = await afterRead(await startBoard(t, { fail: 'read', ghAuth: 'failed' }));
  assert.deepEqual(data.tools, {});
  assert.match(data.error, /gh auth status failed: error connecting to api\.github\.com/);
});

test('a failed read with gh logged in stays Stale with the read\'s error', async (t) => {
  const data = await afterRead(await startBoard(t, { fail: 'read' }));
  assert.deepEqual(data.tools, {});
  assert.match(data.error, /HTTP 502: Bad Gateway/);
});

test('sample mode looks no tools up', async (t) => {
  const board = await startBoard(t, {}, true);
  assert.equal((await board.board()).tools, undefined);
  assert.equal((await recheck(board)).status, 403);
});
