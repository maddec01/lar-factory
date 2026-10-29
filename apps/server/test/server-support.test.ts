import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { startBoard } from './server-support.ts';

test('a slow startup failure keeps its diagnostic until the child closes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'lar-slow-start-'));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'src'));
  // Deliberately outlast the old 100 x 25 ms startup poll. The assertion waits for exit, not a sleep.
  await writeFile(join(dir, 'src/server.ts'), `setTimeout(() => {
    process.stderr.write('delayed startup diagnostic\\n', () => process.exit(1));
  }, 3_000);`);
  await assert.rejects(startBoard(t, {}, true, false, {}, dir), /delayed startup diagnostic/);
});

test('waiting for server output finds past messages and rejects if the board closes before a future message', async (t) => {
  const board = await startBoard(t);
  await board.untilLogged(`board on ${board.url}`);
  assert.deepEqual(await board.untilCalled((args) => args[0] === '--version'), ['--version']);
  const waiting = assert.rejects(board.untilLogged('a message that never arrives'), /Board closed before the expected message/);
  await board.stop();
  await waiting;
  await assert.rejects(board.untilLogged('a message that never arrives'), /Board closed before the expected message/);
});

const alive = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

test('stopping a board also stops the gh it is still running', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(1, 'List')], readDelay: 5000 }, false, true);
  // The fake gh logs a call as it starts, and this issue read then sleeps.
  for (let attempt = 0; attempt < 200; attempt++) {
    if ((await board.calls()).some((args) => args.some((a) => a.includes('states: [OPEN]')))) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const children = execFileSync('pgrep', ['-P', String(board.pid)], { encoding: 'utf8' }).trim().split('\n').map(Number);
  assert.ok(children.length, 'the board never ran gh');
  await board.stop();
  for (let attempt = 0; attempt < 40 && children.some(alive); attempt++) await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual(children.filter(alive), []);
});
