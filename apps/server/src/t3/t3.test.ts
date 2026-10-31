import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { T3Run } from './t3.ts';
import type { RunResult } from '../tools/run-tool.ts';

/** A t3 stub that answers every call with `result` and keeps each call's arguments and timeout. */
function t3With(result: Partial<RunResult>) {
  const calls: { args: string[]; timeout: number }[] = [];
  const run: T3Run = async (args, timeout) => {
    calls.push({ args, timeout });
    return { code: 0, stdout: '', stderr: '', detail: '', ...result };
  };
  return { run, calls };
}

test('only the exact unavailable answer releases a thread', async () => {
  const { lookupThread } = await import('./t3.ts');
  for (const result of [
    { code: 1, stdout: '', stderr: 'Thread abc is no longer available.' },
    { code: 1, stdout: '{}', stderr: 'Thread abc is no longer available.' },
    { code: 0, stdout: '{"thread":{"threadId":"abc"},"messages":[]}' },
    { code: 0, stdout: '{}' },
  ]) {
    const answer = await lookupThread('abc', t3With(result).run);
    assert.equal(answer, result.code === 0 && result.stdout.includes('threadId') ? 'live'
      : result.code === 1 && result.stdout === '' ? 'deleted' : 'unknown');
  }
});

 test('unconfirmed launch outcomes stay protected, including command failures', async () => {
  const { startThread } = await import('./t3.ts');
  for (const result of [{ code: null }, { code: 1 }, { code: 0, stdout: '{}' },
    { code: 0, stdout: 'invalid JSON' }]) {
    assert.equal((await startThread('p', 'm', undefined, undefined, t3With(result).run)).uncertain, true);
  }
  const launched = await startThread('p', 'm', undefined, { base: 'main', branch: 'build' },
    t3With({ stdout: '{"threadId":"late","title":"Build"}' }).run);
  assert.deepEqual(launched, { thread: { threadId: 'late', title: 'Build' }, error: null });
});

test('recovers one late success and holds ambiguous or absent CLI evidence', async () => {
  const { startThread } = await import('./t3.ts');
  for (const count of [0, 1, 2]) {
    const run: T3Run = async args => ({ code: args[1] === 'start' ? null : 0, stderr: '', detail: '',
      stdout: args[1] === 'list' ? JSON.stringify(Array.from({ length: count }, (_, i) => ({ threadId: `late-${i}`, title: 'Build' })))
        : JSON.stringify({ thread: { threadId: args[2] }, messages: [{ role: 'user', text: 'Build\nissue' }] }) });
    const answer = await startThread('project', 'Build\nissue', undefined, undefined, run);
    assert.equal(answer.thread?.threadId, count === 1 ? 'late-0' : undefined);
    assert.equal(answer.uncertain, count === 1 ? undefined : true);
  }
});

test('finding a started thread skips the recorded ones, and tells absent from unread', async () => {
  const { findStartedThread } = await import('./t3.ts');
  const listing = (ids: string[], code: number = 0): T3Run => async (args) => ({ code: args[1] === 'list' ? code : 0, stderr: '', detail: '',
    stdout: args[1] === 'list' ? JSON.stringify(ids.map((threadId) => ({ threadId, title: 'Build' })))
      : JSON.stringify({ thread: { threadId: args[2] }, messages: [{ role: 'user', text: 'Build\nissue' }] }) });
  assert.deepEqual(await findStartedThread('project', 'Build\nissue', ['old'], listing(['old', 'new'])), { threadId: 'new', title: 'Build' });
  assert.equal(await findStartedThread('project', 'Build\nissue', ['old'], listing(['old'])), 'absent');
  assert.equal(await findStartedThread('project', 'Build\nissue', [], listing([], 1)), 'unknown');
  assert.equal(await findStartedThread('project', 'Build\nissue', [], listing(['a', 'b'])), 'unknown', 'two matches establish nothing');
});
