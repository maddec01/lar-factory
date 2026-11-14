import { expect, test } from 'vite-plus/test';

import { deskWait, questionWaitReason } from './desk-wait.ts';
import { humanWait } from './human-wait.ts';
import type { Item } from './item-domain.ts';
import { releaseApprovalStep } from './release-continuation.ts';

const parent = (done: boolean) =>
    ({
        id: 'group',
        kind: 'concept',
        status: 'Needs you',
        releasePlan: {
            steps: [
                {
                    id: 'approve',
                    who: 'Pedro',
                    what: 'Approve activation of exact manifest',
                    done: done ? { by: 'Pedro', at: '2026-11-14T12:00:00Z', evidence: 'Approved manifest abc.' } : null,
                },
                { id: 'activate', who: 'Agent', what: 'Activate', done: null },
            ],
            outcomeCheck: { result: 'pending' },
        },
        threads: [
            {
                id: 'owner',
                state: 'needs you',
                questionSummary: 'Q2 - Joint sandbox activation: Approve activating the staged artifacts together?',
                pendingRequest: { id: 'q', threadId: 'owner', kind: 'question' },
            },
        ],
    }) as Item;

test('a duplicate question is superseded before and after its board release receipt', () => {
    const item = parent(false);
    const parts = [{ id: 'part', kind: 'build', parentId: item.id, status: 'Done' } as Item];

    expect(deskWait(item, false, parts).action?.label).toBe('Mark release step done');
    expect(questionWaitReason(item)).toMatch(/superseded by the board/);
    expect(deskWait(parent(true), false, parts).action?.label).toBe('Resume release');

    const resumed = { ...parent(true), status: 'In progress' as const };

    expect(humanWait(resumed, false, parts)?.action?.label).toBe('Resume release');
});

test('a failed release notification remains on the desk after its native question clears', () => {
    const item = {
        ...parent(true),
        status: 'In progress' as const,
        threads: [],
        releaseContinuation: { ready: true, digest: 'input', run: null },
    };

    expect(humanWait(item, false, [item])?.action?.label).toBe('Resume release');
});

test('scope questions and tool approvals about releases remain in T3', () => {
    const item = parent(true);
    const thread = Array.isArray(item.threads) && item.threads[0];

    if (!thread) throw new Error('Missing fixture owner');

    thread.questionSummary = 'Which manifest should I approve?';
    expect(releaseApprovalStep(item.releasePlan, thread.questionSummary)).toBeUndefined();
    expect(deskWait(item).action?.label).toBe('Answer in T3');
    thread.questionSummary = 'Approve activating the manifest?';
    thread.pendingRequest!.questions = [thread.questionSummary, 'Which region?'];
    expect(deskWait(item).action?.label).toBe('Answer in T3');
    delete thread.pendingRequest!.questions;
    thread.pendingRequest!.kind = 'tool-approval';
    expect(deskWait(item).label).toBe('Approval in T3');
});

test.each([false, true])(
    'idle release recovery stays available with a generic notice, approval done=%s',
    async (done) => {
        const { releaseRecoveryAvailable } = await import('./release-continuation.ts');
        const item = {
            ...parent(done),
            threads: [],
            releaseContinuation: { ready: false, digest: 'hold', run: null },
            needsYou: { reason: 'Independent scope question', offers: [], causes: [], ticketOpen: false },
        };
        const parts = [{ id: 'part', kind: 'build', parentId: item.id, status: 'Done' } as Item];

        expect(releaseRecoveryAvailable(item, parts)).toBe(true);
        expect(deskWait(item, false, parts).action?.label).toBe(done ? 'Resume release' : 'Mark release step done');
    },
);
