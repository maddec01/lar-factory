import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { startThreadAndWait, type T3Run } from './t3.ts';
import type { RunResult } from '../tools/run-tool.ts';

const CHOICE = { instanceId: 'claudeAgent', model: 'claude-opus-5-5' };

/** A t3 stub that answers every call with `result` and keeps each call's arguments and timeout. */
function t3With(result: Partial<RunResult>) {
  const calls: { args: string[]; timeout: number }[] = [];
  const run: T3Run = async (args, timeout) => {
    calls.push({ args, timeout });
    return { code: 0, stdout: '', stderr: '', detail: '', ...result };
  };
  return { run, calls };
}

const waited = (json: object) => JSON.stringify({ threadId: 'thread-1', runId: 'run-1', reply: null, error: null, ...json });

test('starts the thread with --wait --json, its title and model, and waits 15 minutes', async () => {
  const t3 = t3With({ stdout: waited({ status: 'completed', reply: '{}' }) });
  await startThreadAndWait('project-web', 'Look for Clashes', CHOICE, 'Look for Clashes (run a1)', t3.run);
  assert.deepEqual(t3.calls, [{ args: ['thread', 'start', 'project-web', 'Look for Clashes', '--title', 'Look for Clashes (run a1)',
    '--provider', 'claudeAgent', '--model', 'claude-opus-5-5', '--wait', '--json'], timeout: 15 * 60_000 }]);
});

test('exit 0 is a completed run with its reply', async () => {
  const t3 = t3With({ stdout: waited({ status: 'completed', reply: '{"clashes":[]}' }) });
  assert.deepEqual(await startThreadAndWait('p', 'm', CHOICE, 't', t3.run), { ended: 'completed', threadId: 'thread-1', reply: '{"clashes":[]}' });
});

test('exit 1 is a failed or stopped run with its status and error', async () => {
  const t3 = t3With({ code: 1, stdout: waited({ status: 'interrupted', error: 'The user stopped the run.' }), detail: 'Run interrupted' });
  assert.deepEqual(await startThreadAndWait('p', 'm', CHOICE, 't', t3.run),
    { ended: 'failed', threadId: 'thread-1', why: 'The run ended interrupted: The user stopped the run.' });
});

test('exit 1 before any thread starts gives t3\'s problem and no thread', async () => {
  const t3 = t3With({ code: 1, detail: 'Could not reach the T3 Code server. Is T3 Code running?' });
  assert.deepEqual(await startThreadAndWait('p', 'm', CHOICE, 't', t3.run),
    { ended: 'failed', threadId: null, why: 't3 could not start the thread: Could not reach the T3 Code server. Is T3 Code running?' });
});

test('exit 2 is a run waiting on the user', async () => {
  const t3 = t3With({ code: 2, stdout: waited({ status: 'waiting' }) });
  assert.deepEqual(await startThreadAndWait('p', 'm', CHOICE, 't', t3.run), { ended: 'waiting', threadId: 'thread-1' });
});

test('the timeout ends the wait without a thread id, since t3 prints it only at the end', async () => {
  const t3 = t3With({ code: null });
  assert.deepEqual(await startThreadAndWait('p', 'm', CHOICE, 't', t3.run), { ended: 'timed-out', threadId: null });
});

test('a missing t3 is a failed run that says how to install it', async () => {
  const t3 = t3With({ code: 'ENOENT' });
  const run = await startThreadAndWait('p', 'm', CHOICE, 't', t3.run);
  assert.deepEqual(run.ended, 'failed');
  assert.match((run as { why: string }).why, /^t3 was not found\. Install the T3 Code CLI or set T3_PATH\.$/);
});
