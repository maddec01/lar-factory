import type { ModelSelection } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test, vi } from 'vite-plus/test';

import type { RunResult } from '../tools/run-tool.ts';
import type { LaunchThread, LaunchWorkspace } from './launch-thread.ts';
import type { T3Run } from './t3.ts';

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

        assert.equal(
            answer,
            result.code === 0 && result.stdout.includes('threadId')
                ? 'live'
                : result.code === 1 && result.stdout === ''
                  ? 'deleted'
                  : 'unknown',
        );
    }
});

test('unconfirmed launch outcomes stay protected, including command failures', async () => {
    const { startThread } = await import('./t3.ts');

    for (const result of [
        { code: null },
        { code: 1 },
        { code: 0, stdout: '{}' },
        { code: 0, stdout: 'invalid JSON' },
    ]) {
        assert.equal((await startThread('p', 'm', undefined, undefined, t3With(result).run)).uncertain, true);
    }

    const launched = await startThread(
        'p',
        'm',
        undefined,
        { base: 'main', branch: 'build' },
        t3With({ stdout: '{"threadId":"late","title":"Build"}' }).run,
    );

    assert.deepEqual(launched, { thread: { threadId: 'late', title: 'Build' }, error: null });
});

test('finding a started thread skips the recorded ones, and tells absent from unread', async () => {
    const { findStartedThread } = await import('./t3.ts');
    const listing =
        (ids: string[], code: number = 0): T3Run =>
        async (args) => ({
            code: args[1] === 'list' ? code : 0,
            stderr: '',
            detail: '',
            stdout:
                args[1] === 'list'
                    ? JSON.stringify(ids.map((threadId) => ({ threadId, title: 'Build' })))
                    : JSON.stringify({
                          thread: { threadId: args[2] },
                          messages: [{ role: 'user', text: 'Build\nissue' }],
                      }),
        });

    assert.deepEqual(await findStartedThread('project', ['Build\nissue'], ['old'], listing(['old', 'new'])), {
        threadId: 'new',
        title: 'Build',
    });
    assert.equal(await findStartedThread('project', ['Build\nissue'], ['old'], listing(['old'])), 'absent');
    assert.equal(await findStartedThread('project', ['Build\nissue'], [], listing([], 1)), 'unknown');
    assert.equal(
        await findStartedThread('project', ['Build\nissue'], [], listing(['a', 'b'])),
        'unknown',
        'two matches establish nothing',
    );
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

test('a record-backed Project default launch freezes its resolved options and keeps its intent ID on an uncertain result', async () => {
    const { startThread } = await import('./t3.ts');
    const { run, calls } = t3With({});
    const remember = vi.fn();
    const request = {
        projectId: 'project',
        text: 'Build',
        selection: { ...OPUS, options: MEDIUM },
        workspace: { type: 'root' as const },
        runtimeMode: 'full-access',
    };
    const launch: LaunchThread = async (
        projectId,
        text,
        selection,
        workspace,
        runtimeMode,
        _origin,
        commandId,
        save,
    ) => {
        assert.equal(commandId, 'saved-intent');
        save!({ projectId, text, selection, workspace, runtimeMode });

        return { thread: null, uncertain: true, error: 'First turn not confirmed.' };
    };
    const answer = await startThread(
        'project',
        'Build',
        undefined,
        undefined,
        run,
        () => ({ selection: request.selection, runtimeMode: request.runtimeMode }),
        launch,
        { commandId: 'saved-intent', remember },
    );

    assert.equal(answer.uncertain, true);
    assert.equal(answer.error, 'First turn not confirmed.');
    assert.deepEqual(remember.mock.calls, [[request]]);
    assert.deepEqual(calls, [], 'the saved command is resumed instead of a title-based CLI lookup');
});

test('a choice equal to the T3 Project default launches with its options, in each workspace', async () => {
    const { startThread } = await import('./t3.ts');
    const { sent, launch, defaults } = launches({ ...OPUS, options: MEDIUM });
    const { run, calls } = t3With({});

    await startThread('p', 'T\nm', OPUS, undefined, run, defaults, launch);
    await startThread('p', 'T\nm', OPUS, { base: 'main', branch: 'build' }, run, defaults, launch);
    await startThread(
        'p',
        'T\nm',
        OPUS,
        { type: 'existing_worktree', worktreePath: '/w', branch: 'build' },
        run,
        defaults,
        launch,
    );
    assert.deepEqual(
        sent.map((s) => s.selection),
        [
            { ...OPUS, options: MEDIUM },
            { ...OPUS, options: MEDIUM },
            { ...OPUS, options: MEDIUM },
        ],
    );
    assert.deepEqual(
        sent.map((s) => s.workspace),
        [
            { type: 'root' },
            { type: 'worktree', baseRef: 'main', branch: 'build' },
            { type: 'existing_worktree', worktreePath: '/w', branch: 'build' },
        ],
    );
    assert.equal(calls.length, 0, 'an explicit choice never goes through the CLI');
});

test('new and resumed launches follow T3 project runtime approval-required', async () => {
    const { startThread } = await import('./t3.ts');
    const { sent, launch, defaults } = launches(null, 'approval-required');

    await startThread('p', 'T\nm', OPUS, { base: 'main', branch: 'build' }, t3With({}).run, defaults, launch);
    await startThread(
        'p',
        'T\nm',
        OPUS,
        { type: 'existing_worktree', worktreePath: '/w', branch: 'build' },
        t3With({}).run,
        defaults,
        launch,
    );
    assert.deepEqual(
        sent.map((s) => s.runtimeMode),
        ['approval-required', 'approval-required'],
    );
});

test('T3 Project default sends no model through the CLI, and an existing worktree refuses it', async () => {
    const { startThread } = await import('./t3.ts');
    const { sent, launch, defaults } = launches({ ...OPUS, options: MEDIUM });
    const { run, calls } = t3With({ stdout: '{"threadId":"t","title":"T"}' });

    await startThread('p', 'm', undefined, { base: 'main', branch: 'b' }, run, defaults, launch);
    assert.deepEqual(calls[0]!.args, ['thread', 'start', 'p', 'm', '--worktree', 'main', '--branch', 'b', '--json']);

    const refused = await startThread(
        'p',
        'm',
        undefined,
        { type: 'existing_worktree', worktreePath: '/w', branch: 'b' },
        run,
        defaults,
        launch,
    );

    assert.deepEqual(refused, { thread: null, error: 'Choose a model before continuing in an existing worktree.' });
    assert.equal(sent.length, 0);
});

test('a launch that lost its answer recovers from the thread list, and starts no second launch', async () => {
    const { startThread } = await import('./t3.ts');
    let launched = 0;
    const lost: LaunchThread = async () => {
        launched += 1;

        return { thread: null, uncertain: true, error: 'lost' };
    };
    const defaults = () => ({ selection: null, runtimeMode: 'full-access' });
    const found: T3Run = async (args) => ({
        code: 0,
        stderr: '',
        detail: '',
        stdout:
            args[1] === 'list'
                ? JSON.stringify([{ threadId: 'late', title: 'Build' }])
                : JSON.stringify({ thread: { threadId: 'late' }, messages: [{ role: 'user', text: 'Build\nissue' }] }),
    });

    assert.deepEqual(await startThread('p', 'Build\nissue', OPUS, undefined, found, defaults, lost), {
        thread: { threadId: 'late', title: 'Build' },
        error: null,
    });
    assert.equal((await startThread('p', 'Other\nissue', OPUS, undefined, found, defaults, lost)).uncertain, true);
    assert.equal(launched, 2, 'one launch per start');
});
