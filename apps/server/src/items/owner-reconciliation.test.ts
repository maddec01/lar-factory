import { deskWait, placementOf } from '@lar-factory/shared';
import { openWorkRecords } from '@lar-factory/work-records';
import { roleFinish } from '@lar-factory/work-records/run-settings';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';

import { executionItemThreads } from '../t3/item-execution.ts';
import { reconcileOwnerActivity, reconcileOwnerQuestion } from './owner-reconciliation.ts';
import { recordItems } from './record-items.ts';

test('S05 F3: terminal approver 55.779, continuation 56.264, reconciliation 56.343; owner saves first', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'approver-race-'));
    const records = await openWorkRecords(join(dir, 'work.db'));
    const executionId = 'add11520-8db5-4ad2-b62d-d0119d12341b';
    const taskId = `node:delegated-task:command%3Amcp%3Afixture%3Adelegate-task%3A${executionId}`;
    const childId = taskId.replace('node:', 'thread:');
    const selection = {
        instanceId: 'codex',
        model: 'gpt-6.1-sol',
        options: [{ id: 'reasoningEffort', value: 'high' }],
    };

    try {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-14T12:48:54.282Z'));

        const work = records.create({
            title: 'Display the v1 greeting',
            repository: 'fake/c',
            kind: 'build',
            status: 'Review',
        });
        const id = work.workId;
        const rev = () => records.read(id).revision;

        records.addThread(id, rev(), 'owner', 'build');
        records.snapshotRun(id, rev(), {
            runId: 'build',
            kind: 'build',
            threadSelection: selection,
            skills: [],
            packaged: {
                version: 'test',
                reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
            },
        });
        records.startRoleRun(id, rev(), {
            runId: 'build',
            executionId,
            role: 'approver',
            launchOptions: selection.options,
        });

        const item = recordItems(records, [], ['fake/c'])[0]!;

        item.threads = [
            { id: 'owner', purpose: 'build', title: 'Owner', state: 'done', updated: '2026-11-14T12:50:56.264Z' },
        ];

        const task = {
            id: taskId,
            threadId: 'owner',
            origin: 'app_owned',
            childThreadId: childId,
            status: 'completed',
            result: 'Recommend Verify: approved brief requires it.',
            completedAt: '2026-11-14T12:50:55.779Z',
        };
        const read = vi.fn(async (threadId: string) =>
            threadId === 'owner'
                ? { thread: { id: threadId }, runs: [{ status: 'running' }], subagents: [task] }
                : {
                      thread: { id: threadId },
                      runs: [{ id: 'terminal', status: 'completed', modelSelection: selection }],
                      subagents: [],
                  },
        );

        vi.setSystemTime(new Date('2026-11-14T12:50:56.264Z'));
        await reconcileOwnerActivity(records, item, async () => {
            throw new Error('T3 unavailable');
        });
        expect(records.runSettings(id).roleRuns[0]).toMatchObject({
            result: 'running',
            report: null,
            reconciliationHold: expect.stringContaining('retry'),
        });
        expect(records.read(id).needsYou).toBeNull();

        const settling = reconcileOwnerActivity(records, item, read);

        const attempt = records.runSettings(id).roleRuns[0]!;

        records.finishRoleRun(
            id,
            rev(),
            roleFinish(attempt, {
                taskId,
                status: 'completed',
                hasPendingChildRuns: false,
                providerInstanceId: selection.instanceId,
                executedModel: selection.model,
                options: selection.options,
                summary: task.result,
            }),
        );

        vi.setSystemTime(new Date('2026-11-14T12:50:56.343Z'));
        await settling;

        const saved = records.runSettings(id).roleRuns[0]!;

        expect(saved).toMatchObject({
            result: 'completed',
            failure: null,
            summary: task.result,
            report: { reference: taskId },
            actual: { model: { instanceId: 'codex', model: 'gpt-6.1-sol' }, effort: 'high' },
        });
        expect(() =>
            records.finishRoleRun(id, rev(), {
                executionId,
                result: 'completed',
                report: saved.report,
                summary: task.result,
            }),
        ).not.toThrow();

        const revision = rev();

        await reconcileOwnerActivity(records, item, read);
        expect(rev()).toBe(revision);
        expect(records.read(id).needsYou).toBeNull();
    } finally {
        vi.useRealTimers();
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('the request-free owner and its resolved notice are published together, including an idle owner', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'question-truth-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    t.onTestFinished(() => {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    });

    const { workId } = records.create({
        title: 'Greeting',
        repository: 'fake/app',
        kind: 'feature',
        status: 'Shaping',
    });

    records.addThread(workId, records.read(workId).revision, 'owner', 'shape');
    records.waitForUser(workId, records.read(workId).revision, 'Gold or amber?');

    // Round 2: the legacy instructions wrote Needs you, the 2 s local poll saw it, then T3 opened its request.
    const observe = (pendingRuntimeRequest: unknown) => {
        const item = recordItems(records, [], ['fake/app'])[0]!;

        item.threads = executionItemThreads([
            {
                id: 'owner',
                title: 'Shape',
                status: 'running',
                updatedAt: new Date().toISOString(),
                pendingRuntimeRequest,
            },
        ])(['owner'])!.map((thread) => ({ ...thread, purpose: 'shape' }));

        return reconcileOwnerQuestion(records, item);
    };

    observe(null);

    const question = observe({ id: 'question', kind: 'user-input' });

    expect(deskWait(question).label).toBe('Question');
    expect(placementOf(question, { unavailable: false, all: [question] }).sections).toContain('desk');

    const item = recordItems(records, [], ['fake/app'])[0]!;

    item.threads = [
        { id: 'owner', title: 'Shape', purpose: 'shape', state: 'done', updated: new Date().toISOString() },
    ];

    const cached = {
        ...item,
        threads: item.threads.map((thread) => ({ ...thread, observedAt: new Date().toISOString() })),
    };

    expect(reconcileOwnerQuestion(records, cached).needsYou).toBeDefined();

    const resolved = reconcileOwnerQuestion(records, item);

    expect(resolved.status).toBe('Shaping');
    expect(resolved.needsYou).toBeUndefined();
    expect(placementOf(resolved, { unavailable: false, all: [resolved] }).sections).not.toContain('desk');
});

test('an attempt found abandoned is reread only after its owner changes, recovering a late result', async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'ended-attempt-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    t.onTestFinished(() => {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    });

    const { workId } = records.create({ title: 'Greeting', repository: 'fake/c', kind: 'build', status: 'Review' });
    const rev = () => records.read(workId).revision;

    records.addThread(workId, rev(), 'owner', 'build');
    records.snapshotRun(workId, rev(), {
        runId: 'build',
        kind: 'build',
        threadSelection: { instanceId: 'codex', model: 'gpt-6.1-sol', options: [] },
        skills: [],
        packaged: {
            version: 'test',
            reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
        },
    });
    records.startRoleRun(workId, rev(), {
        runId: 'build',
        executionId: 'attempt',
        role: 'approver',
        launchOptions: [],
    });

    const item = recordItems(records, [], ['fake/c'])[0]!;

    item.threads = [
        { id: 'owner', purpose: 'build', title: 'Owner', state: 'done', updated: new Date().toISOString() },
    ];

    const selection = { instanceId: 'codex', model: 'gpt-6.1-sol', options: [] };
    const taskId = 'node:delegated-task:command%3Amcp%3Afixture%3Adelegate-task%3Aattempt';
    let subagents: unknown[] = [];
    const read = vi.fn(async (id: string) =>
        id === 'owner'
            ? { thread: { id }, runs: [{ status: 'completed' }], subagents }
            : { thread: { id }, runs: [{ status: 'completed', modelSelection: selection }], subagents: [] },
    );

    await reconcileOwnerActivity(records, item, read);
    expect(records.runSettings(workId).roleRuns[0]).toMatchObject({ result: 'failed', inferredAbandonment: true });

    read.mockClear();
    await reconcileOwnerActivity(records, item, read);
    expect(read).not.toHaveBeenCalled();

    // The role's result lands in T3 later, and the owner thread's update reveals it.
    subagents = [
        {
            id: taskId,
            threadId: 'owner',
            origin: 'app_owned',
            childThreadId: 'child',
            status: 'completed',
            result: 'Approved.',
        },
    ];
    item.threads[0]!.updated = new Date(Date.now() + 1000).toISOString();
    // A read that fails is not taken as settled: the next pass reads again with the owner unchanged.
    read.mockRejectedValueOnce(new Error('T3 unavailable'));
    await reconcileOwnerActivity(records, item, read);
    expect(records.runSettings(workId).roleRuns[0]).toMatchObject({ result: 'failed', inferredAbandonment: true });
    await reconcileOwnerActivity(records, item, read);
    expect(records.runSettings(workId).roleRuns[0]).toMatchObject({
        result: 'completed',
        inferredAbandonment: false,
        summary: 'Approved.',
        report: { reference: taskId },
    });
});
