import { describe, it, expect } from 'vite-plus/test';

import { executionItemThreads } from './item-execution.ts';

describe('recorded thread lookup', () => {
    const shell = { id: 'root', title: 'Build', updatedAt: '2026-10-31T12:00:00Z', status: 'idle' };

    it('shows the recorded threads, archived ones too, whatever their first message names', () => {
        const lookup = executionItemThreads([
            shell,
            { ...shell, id: 'other' },
            { ...shell, id: 'put-away', archivedAt: shell.updatedAt },
        ]);

        expect(lookup(['root'])).toEqual([{ id: 'root', title: 'Build', state: 'done', updated: shell.updatedAt }]);
        expect(lookup(['put-away'])).toEqual([
            { id: 'put-away', title: 'Build', state: 'done', archived: true, updated: shell.updatedAt },
        ]);
    });
    it('keeps a finished thread at work while it or a descendant has background tasks, without holding a start', () => {
        const parent = { ...shell, status: 'completed' };
        const child = {
            ...shell,
            id: 'child',
            status: 'completed',
            lineage: { parentThreadId: 'root' },
            pendingBackgroundTasks: [{ kind: 'subagent' }],
        };
        const [own] = executionItemThreads([{ ...parent, pendingBackgroundTasks: [{ kind: 'shell' }] }])(['root'])!;

        expect(own).toMatchObject({ state: 'done', hasRunningChildren: true });
        expect(own).not.toHaveProperty('hasLiveChildren');
        expect(executionItemThreads([parent, child])(['root'])?.[0]).toMatchObject({
            state: 'done',
            hasRunningChildren: true,
        });
        for (const noSignal of [[], { kind: 'shell' }, undefined])
            expect(
                executionItemThreads([{ ...parent, pendingBackgroundTasks: noSignal }])(['root'])?.[0],
            ).not.toHaveProperty('hasRunningChildren');
    });
    it('keeps an active run visible when a newer message was cancelled or queued', () => {
        for (const status of ['cancelled', 'queued', 'completed']) {
            const lookup = executionItemThreads([
                { ...shell, status, activeRunId: 'older-run', activityRunStatus: 'running' },
            ]);

            expect(lookup(['root'])?.[0]).toMatchObject({ state: 'running', currentRunning: true });
            expect(lookup(['root'])?.[0]).not.toHaveProperty('queued');
        }
        expect(
            executionItemThreads([{ ...shell, status: 'cancelled', activityRunStatus: 'waiting' }])(['root'])?.[0],
        ).toMatchObject({ state: 'running' });
        expect(
            executionItemThreads([
                { ...shell, activityRunStatus: 'running', pendingRuntimeRequest: { id: 'question' } },
            ])(['root'])?.[0],
        ).toMatchObject({ state: 'needs you' });
        expect(
            executionItemThreads([{ ...shell, status: 'cancelled', activityRunStatus: null }])(['root'])?.[0],
        ).toMatchObject({ state: 'stopped' });
    });
});

it('keeps the pending user question without exposing the runtime request payload', () => {
    const lookup = executionItemThreads([
        {
            id: 'question',
            title: 'Shape',
            updatedAt: '2026-11-01T12:00:00Z',
            pendingRuntimeRequest: {
                id: 'request',
                command: 'private command',
                request: {
                    questions: [
                        { question: 'Which account should own this server?', options: [{ label: 'Personal' }] },
                    ],
                },
            },
        },
    ]);

    expect(lookup(['question'])?.[0]).toMatchObject({
        state: 'needs you',
        questionSummary: 'Which account should own this server?',
    });
    expect(JSON.stringify(lookup(['question']))).not.toContain('private command');
});

it('S08 F03: a finished owner advertises Doubt only while its named child execution runs', () => {
    const owner = { id: 'shape-owner', title: 'Shaping ST', status: 'completed', updatedAt: '2026-11-14T00:00:00Z' };
    const child = {
        id: 'doubt-child',
        title: 'Doubt · ST',
        lineage: { parentThreadId: 'shape-owner', rootThreadId: 'shape-owner' },
        status: 'running',
        updatedAt: owner.updatedAt,
    };

    expect(executionItemThreads([owner, child])(['shape-owner'])?.[0]?.doubtRunning).toBe(true);
    expect(
        executionItemThreads([owner, { ...child, status: 'completed' }])(['shape-owner'])?.[0]?.doubtRunning,
    ).toBeUndefined();
    expect(
        executionItemThreads([owner, { ...child, title: 'Explore · ST' }])(['shape-owner'])?.[0]?.doubtRunning,
    ).toBeUndefined();
});
