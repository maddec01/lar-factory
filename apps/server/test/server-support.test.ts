import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { startBoard } from './server-support.ts';

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
