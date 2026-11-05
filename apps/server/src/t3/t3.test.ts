import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { ModelSelection } from '@lar-factory/shared';
import type { T3Run } from './t3.ts';
import type { LaunchThread, LaunchWorkspace } from './launch-thread.ts';
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
  assert.deepEqual(await findStartedThread('project', ['Build\nissue'], ['old'], listing(['old', 'new'])), { threadId: 'new', title: 'Build' });
  assert.equal(await findStartedThread('project', ['Build\nissue'], ['old'], listing(['old'])), 'absent');
  assert.equal(await findStartedThread('project', ['Build\nissue'], [], listing([], 1)), 'unknown');
  assert.equal(await findStartedThread('project', ['Build\nissue'], [], listing(['a', 'b'])), 'unknown', 'two matches establish nothing');
});

/** T3 answering with `threads`, each its title and first message, and listing a duplicated row as `duplicate`. */
const threadsOf = (threads: Record<string, { title: string; text: string }>, duplicate?: string): T3Run => async (args) => ({ code: 0, stderr: '', detail: '',
  stdout: args[1] === 'list' ? JSON.stringify([...Object.keys(threads), ...duplicate ? [duplicate] : []].map((threadId) => ({ threadId, title: threads[threadId]!.title })))
    : JSON.stringify({ thread: { threadId: args[2] }, messages: [{ role: 'user', text: threads[args[2]!]!.text }] }) });

const CURRENT = 'Shaping #7 T\nShape w1.';
const EARLIER = '#7 T\nShape w1.';

test('finding a started thread considers every message format together, one thread across them resolving it', async () => {
  const { findStartedThread } = await import('./t3.ts');
  const current = { title: 'Shaping #7 T', text: CURRENT };
  const earlier = { title: '#7 T', text: EARLIER };
  assert.deepEqual(await findStartedThread('p', [CURRENT, EARLIER], [], threadsOf({ a: earlier })), { threadId: 'a', title: '#7 T' });
  assert.deepEqual(await findStartedThread('p', [CURRENT, EARLIER], [], threadsOf({ a: current })), { threadId: 'a', title: 'Shaping #7 T' });
  assert.equal(await findStartedThread('p', [CURRENT, EARLIER], [], threadsOf({ a: current, b: earlier })), 'unknown', 'one in each format establishes nothing');
  assert.deepEqual(await findStartedThread('p', [CURRENT, EARLIER], [], threadsOf({ a: earlier }, 'a')), { threadId: 'a', title: '#7 T' }, 'a thread listed twice is one thread');
  assert.equal(await findStartedThread('p', [CURRENT, EARLIER], ['a'], threadsOf({ a: earlier })), 'absent');
  assert.equal(await findStartedThread('p', [CURRENT, EARLIER], [], threadsOf({ a: { title: '#7 T', text: '#7 T\nsomething else' } })), 'absent');
});

test('a thread whose long first line T3 cut short is still found by its whole first message', async () => {
  const { findStartedThread, titledFrom } = await import('./t3.ts');
  const message = 'Build w1. Read /Users/someone/.agents/skills/lar-build/agents/builder.md and follow it.\n\nexport PATH=/b';
  assert.deepEqual(await findStartedThread('p', [message], [], threadsOf({ a: { title: 'Build w1. Read /Users/someone/.agents/sk…', text: message } })),
    { threadId: 'a', title: 'Build w1. Read /Users/someone/.agents/sk…' });
  assert.equal(titledFrom('Build w2. Read…', message), false);
  assert.equal(titledFrom('Build w1.', message), false, 'a title with no ellipsis must be the whole line');
});

/** Stubs a project's defaults in T3 and a launch that opens a thread, keeping what each launch sent. */
function launches(selection: ModelSelection | null, runtimeMode = 'full-access') {
  const sent: { project: string; selection: ModelSelection; workspace: LaunchWorkspace; runtimeMode: string }[] = [];
  const launch: LaunchThread = async (project, _text, chosen, workspace, mode) => {
    sent.push({ project, selection: chosen, workspace, runtimeMode: mode });
    return { thread: { threadId: 'launched', title: 'T' }, error: null };
  };
  return { sent, launch, defaults: () => ({ selection, runtimeMode }) };
}

const OPUS = { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5' };
const MEDIUM = [{ id: 'effort', value: 'medium' }];

test('a choice equal to the T3 Project default launches with its options, in each workspace', async () => {
  const { startThread } = await import('./t3.ts');
  const { sent, launch, defaults } = launches({ ...OPUS, options: MEDIUM });
  const { run, calls } = t3With({});
  await startThread('p', 'T\nm', OPUS, undefined, run, defaults, launch);
  await startThread('p', 'T\nm', OPUS, { base: 'main', branch: 'build' }, run, defaults, launch);
  await startThread('p', 'T\nm', OPUS, { type: 'existing_worktree', worktreePath: '/w', branch: 'build' }, run, defaults, launch);
  assert.deepEqual(sent.map((s) => s.selection), [{ ...OPUS, options: MEDIUM }, { ...OPUS, options: MEDIUM }, { ...OPUS, options: MEDIUM }]);
  assert.deepEqual(sent.map((s) => s.workspace), [{ type: 'root' }, { type: 'worktree', baseRef: 'main', branch: 'build' },
    { type: 'existing_worktree', worktreePath: '/w', branch: 'build' }]);
  assert.equal(calls.length, 0, 'an explicit choice never goes through the CLI');
});

test('a T3 Project default stored with no options launches with none, leaving T3 to use the model\'s default effort', async () => {
  const { startThread } = await import('./t3.ts');
  const { sent, launch, defaults } = launches(OPUS);
  await startThread('p', 'T\\nm', OPUS, undefined, t3With({}).run, defaults, launch);
  assert.deepEqual(sent.map((s) => s.selection), [OPUS]);
});

test('another model launches with no options, even on the same provider instance', async () => {
  const { startThread } = await import('./t3.ts');
  const { sent, launch, defaults } = launches({ ...OPUS, options: MEDIUM });
  const sonnet = { instanceId: OPUS.instanceId, model: 'claude-sonnet-5-5' };
  const vi = { instanceId: 'claudeAgent', model: OPUS.model };
  await startThread('p', 'T\nm', sonnet, undefined, t3With({}).run, defaults, launch);
  await startThread('p', 'T\nm', vi, undefined, t3With({}).run, defaults, launch);
  assert.deepEqual(sent.map((s) => s.selection), [sonnet, vi]);
});

test('new launches keep the project runtime mode the CLI gives; the existing worktree keeps approval-required', async () => {
  const { startThread } = await import('./t3.ts');
  const { sent, launch, defaults } = launches(null, 'auto-accept-edits');
  await startThread('p', 'T\nm', OPUS, { base: 'main', branch: 'build' }, t3With({}).run, defaults, launch);
  await startThread('p', 'T\nm', OPUS, { type: 'existing_worktree', worktreePath: '/w', branch: 'build' }, t3With({}).run, defaults, launch);
  assert.deepEqual(sent.map((s) => s.runtimeMode), ['auto-accept-edits', 'approval-required']);
});

test('T3 Project default sends no model through the CLI, and an existing worktree refuses it', async () => {
  const { startThread } = await import('./t3.ts');
  const { sent, launch, defaults } = launches({ ...OPUS, options: MEDIUM });
  const { run, calls } = t3With({ stdout: '{"threadId":"t","title":"T"}' });
  await startThread('p', 'm', undefined, { base: 'main', branch: 'b' }, run, defaults, launch);
  assert.deepEqual(calls[0]!.args, ['thread', 'start', 'p', 'm', '--worktree', 'main', '--branch', 'b', '--json']);
  const refused = await startThread('p', 'm', undefined, { type: 'existing_worktree', worktreePath: '/w', branch: 'b' }, run, defaults, launch);
  assert.deepEqual(refused, { thread: null, error: 'Choose a model before continuing in an existing worktree.' });
  assert.equal(sent.length, 0);
});

test('a choice starts nothing when T3 settings cannot be read', async () => {
  const { startThread } = await import('./t3.ts');
  const { sent, launch } = launches(null);
  const answer = await startThread('p', 'm', OPUS, undefined, t3With({}).run, () => null, launch);
  assert.equal(answer.thread, null);
  assert.ok(answer.error);
  assert.equal(sent.length, 0);
});

test('a lost answer in an existing worktree stays uncertain, as the thread list could name the build\'s earlier thread', async () => {
  const { startThread } = await import('./t3.ts');
  const lost: LaunchThread = async () => ({ thread: null, uncertain: true, error: 'lost' });
  const { run, calls } = t3With({});
  const answer = await startThread('p', 'T\nm', OPUS, { type: 'existing_worktree', worktreePath: '/w', branch: 'b' }, run, () => ({ selection: null, runtimeMode: 'full-access' }), lost);
  assert.equal(answer.uncertain, true);
  assert.match(answer.error!, /could not be confirmed. Check its T3 project/);
  assert.equal(calls.length, 0);
});

test('a launch that lost its answer recovers from the thread list, and starts no second launch', async () => {
  const { startThread } = await import('./t3.ts');
  let launched = 0;
  const lost: LaunchThread = async () => { launched += 1; return { thread: null, uncertain: true, error: 'lost' }; };
  const defaults = () => ({ selection: null, runtimeMode: 'full-access' });
  const found: T3Run = async (args) => ({ code: 0, stderr: '', detail: '',
    stdout: args[1] === 'list' ? JSON.stringify([{ threadId: 'late', title: 'Build' }]) : JSON.stringify({ thread: { threadId: 'late' }, messages: [{ role: 'user', text: 'Build\nissue' }] }) });
  assert.deepEqual(await startThread('p', 'Build\nissue', OPUS, undefined, found, defaults, lost), { thread: { threadId: 'late', title: 'Build' }, error: null });
  assert.equal((await startThread('p', 'Other\nissue', OPUS, undefined, found, defaults, lost)).uncertain, true);
  assert.equal(launched, 2, 'one launch per start');
});
