import type { RoleRun } from '@lar-factory/shared/run-settings';
import { expect, test, vi } from 'vite-plus/test';

import { readRoleResult } from './role-result.ts';

const executionId = 'add11520-8db5-4ad2-b62d-d0119d12341b';
const taskId = `node:delegated-task:command%3Amcp%3Afixture%3Adelegate-task%3A${executionId}`;
const selection = { instanceId: 'codex', model: 'gpt-6.1-sol', options: [{ id: 'reasoningEffort', value: 'high' }] };
const attempt: RoleRun = {
    executionId,
    workId: 'work',
    runId: 'build',
    role: 'approver',
    requested: { model: { instanceId: 'codex', model: 'gpt-6.1-sol' }, effort: 'high', options: [] },
    launchOptions: selection.options,
    startedAt: '2026-11-14T12:48:54.282Z',
    endedAt: null,
    result: 'running',
    report: null,
    actual: null,
    failure: null,
};
const task = {
    id: taskId,
    origin: 'app_owned',
    threadId: 'owner',
    childThreadId: 'child',
    status: 'completed',
    result: 'PR delivered. Verify per approved brief.',
};
const child = { thread: { id: 'child' }, runs: [{ status: 'completed', modelSelection: selection }], subagents: [] };

test('only the exact role-launch task can supply a terminal result; malformed and unrelated IDs cannot', async () => {
    const read = vi.fn(async () => child);

    for (const id of ['node:delegated-task:%ZZ', taskId + '-another', taskId.replace(executionId, 'another')]) {
        expect(await readRoleResult(attempt, { thread: { id: 'owner' }, subagents: [{ ...task, id }] }, read)).toEqual({
            absent: true,
        });
    }
    expect(read).not.toHaveBeenCalled();
});

test.each([
    { thread: { id: 'another' }, runs: child.runs, subagents: [] },
    { ...child, runs: [{ status: 'running', modelSelection: selection }] },
    { ...child, subagents: [{ status: 'running' }] },
    { ...child, runs: [{ status: 'completed' }] },
])('unavailable or unsettled child evidence holds for the owner, without inventing a result: %j', async (value) => {
    const result = await readRoleResult(attempt, { thread: { id: 'owner' }, subagents: [task] }, async () => value);

    expect(result.hold).toBeTruthy();
    expect(result.finish).toBeUndefined();
    expect(result.absent).toBeUndefined();
});

test('a real failed terminal task retains its actual model and failure; a mismatch cannot become success', async () => {
    const failed = await readRoleResult(
        attempt,
        { thread: { id: 'owner' }, subagents: [{ ...task, status: 'failed', result: 'Check failed' }] },
        async () => ({ ...child, runs: [{ ...child.runs[0], status: 'failed' }] }),
    );

    expect(failed.finish).toMatchObject({
        result: 'failed',
        report: { reference: taskId },
        summary: 'Check failed',
        failure: expect.stringContaining('not finished successfully'),
    });

    const mismatch = await readRoleResult(attempt, { thread: { id: 'owner' }, subagents: [task] }, async () => ({
        ...child,
        runs: [{ status: 'completed', modelSelection: { ...selection, model: 'different' } }],
    }));

    expect(mismatch.finish).toMatchObject({ result: 'failed', failure: expect.stringContaining('mismatch') });
});

test('provider-reported execution takes precedence over requested model, scoped to the terminal attempt', async () => {
    const actual = await readRoleResult(attempt, { thread: { id: 'owner' }, subagents: [task] }, async () => ({
        ...child,
        runs: [{ ...child.runs[0], activeAttemptId: 'terminal-attempt' }],
        providerTurns: [
            { runAttemptId: 'terminal-attempt', ordinal: 1, model: 'earlier' },
            { runAttemptId: 'terminal-attempt', ordinal: 2, model: 'actually-executed' },
            { runAttemptId: 'another-attempt', ordinal: 99, model: selection.model },
        ],
    }));

    expect(actual.finish).toMatchObject({
        result: 'failed',
        report: { actual: { model: { model: 'actually-executed' } } },
        failure: expect.stringContaining('mismatch'),
    });
});
