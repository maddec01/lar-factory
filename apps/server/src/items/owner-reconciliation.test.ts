import { openWorkRecords } from '@lar-factory/work-records';
import { roleFinish } from '@lar-factory/work-records/run-settings';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';

import { reconcileOwnerActivity } from './owner-reconciliation.ts';
import { recordItems } from './record-items.ts';

test('S08 F04: an answered request clears its old desk notice when its owner resumes; new notices stay', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'owner-wait-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        const work = records.create({ title: 'SA', repository: 'fake/a', kind: 'build', status: 'Shaping' });

        records.addThread(work.workId, work.revision, 'owner', 'shape');
        records.waitForUser(work.workId, records.read(work.workId).revision, 'Gold or amber?');

        const item = recordItems(records, [], ['fake/a'])[0]!;

        item.threads = [
            {
                id: 'owner',
                purpose: 'shape',
                title: 'Owner',
                state: 'running',
                currentRunning: true,
                updated: '2099-01-01T00:00:00Z',
            },
        ];
        item.threads[0]!.pendingRequest = { id: 'q1', threadId: 'owner', kind: 'question' };
        await reconcileOwnerActivity(records, item);
        delete item.threads[0]!.pendingRequest;
        records.setBody(
            work.workId,
            records.read(work.workId).revision,
            'brief',
            'Gold answer saved before the next refresh',
        );
        await reconcileOwnerActivity(records, item);
        expect(records.read(work.workId)).toMatchObject({ needsYou: null, status: 'Shaping' });
        records.waitForUser(work.workId, records.read(work.workId).revision, 'A new product question');
        item.threads[0]!.updated = '2000-01-01T00:00:00Z';
        await reconcileOwnerActivity(records, item);
        expect(records.read(work.workId).needsYou).toBe('A new product question');
        item.threads[0]!.updated = '2099-01-01T00:00:00Z';
        item.threads[0]!.pendingRequest = { id: 'q2', threadId: 'owner', kind: 'question' };
        await reconcileOwnerActivity(records, item);
        expect(records.read(work.workId).needsYou).toBe('A new product question');
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test.each([false, true])(
    'S05 F3: terminal approver 55.779, continuation 56.264, reconciliation 56.343; owner saves first=%s',
    async (ownerFirst) => {
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

            if (ownerFirst) {
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
            }

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
    },
);
