import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import { placementOf } from './board-view.ts';
import { deskWait, questionWaitReason } from './desk-wait.ts';
import { nextAction } from './item-next-action.ts';
import type { Item, ItemThread } from './model.ts';

const stopped: ItemThread = { id: 'build', title: 'Build', purpose: 'build', state: 'stopped', updated: '2026-11-13' };
const item = (patch: Partial<Item> = {}): Item => ({
    ...(sample.items[0] as Item),
    status: 'In progress',
    parentId: null,
    flow: 'single',
    linkedPrs: [
        { state: 'open', mergeState: 'can merge', checks: { passed: 1, failed: 0, running: 0, total: 1, since: null } },
    ] as Item['linkedPrs'],
    threads: [],
    ...patch,
});

test.each([
    ['question', 'Question', 'Answer in T3'],
    ['tool-approval', 'Approval in T3', 'Answer in T3'],
    ['brief-approval', 'Approve brief', 'Approve brief'],
] as const)('%s names its wait and exact request owner', (kind, label, action) => {
    const work = item({
        threads: [{ ...stopped, state: 'needs you', pendingRequest: { id: 'request', threadId: 'owner', kind } }],
    });

    expect(deskWait(work)).toEqual({ label, action: { kind: 'thread', label: action, threadId: 'owner' } });
    expect(nextAction(work)).toEqual({ kind: 'thread', label: action, threadId: 'owner' });
});

test.each([
    ['Verify', 'Verify build', 'Verify build'],
    ['Ready to merge', 'Merge PR', 'Merge PR'],
] as const)('%s names its PR action', (status, label, action) => {
    expect(deskWait(item({ status }))).toEqual({ label, action: { kind: 'pr', label: action } });
});

test.each(['single', 'linked'] as const)('a stopped %s build stays in its section and reaches the desk', (flow) => {
    const work = item({ flow, threads: [stopped] });

    expect(placementOf(work, { all: [work], unavailable: false }).sections).toEqual([
        'desk',
        flow === 'linked' ? 'dock' : 'build',
    ]);
    expect(deskWait(work)).toEqual({ label: 'Run stopped', action: { kind: 'retry-build', label: 'Retry start' } });
});

test('a stopped build with recorded progress resumes its existing thread', () => {
    expect(deskWait(item({ buildPhase: 'implement', threads: [stopped] })).action).toEqual({
        kind: 'thread',
        label: 'Resume in T3',
        threadId: 'build',
    });
});

test('stopped shaping offers the existing resume control', () => {
    expect(deskWait(item({ status: 'Shaping', threads: [{ ...stopped, purpose: 'shape' }] })).action).toEqual({
        kind: 'resume-shaping',
        label: 'Resume shaping',
    });
});

test.each([
    { threads: [{ ...stopped, observedAt: '2026-11-13' }] },
    { threads: [{ ...stopped, hasLiveChildren: true }] },
    { threads: [{ ...stopped, hasRunningChildren: true }] },
    { threads: [{ ...stopped, archived: true }] },
    { threads: [{ ...stopped, state: 'done' }] },
    { status: 'Ready', threads: [stopped] },
    { threads: 'unavailable' },
] satisfies Partial<Item>[])(
    'retained, working and inactive observations do not become stopped desk waits: %j',
    (patch) => {
        const work = item(patch);

        expect(placementOf(work, { all: [work], unavailable: false }).sections).not.toContain('desk');
    },
);

test('unavailable activity cannot put a stopped run on the desk', () => {
    const work = item({ threads: [stopped] });

    expect(placementOf(work, { all: [work], unavailable: true }).sections).not.toContain('desk');
});

test.each([
    ['brief-approval', 'Approve brief'],
    ['tool-approval', 'Answer in T3'],
    ['question', 'Answer in T3'],
] as const)('an unstarted concept part resolves its inherited %s', (kind, label) => {
    const parent = item({
        id: 'concept',
        kind: 'concept',
        threads: [
            { ...stopped, state: 'needs you', pendingRequest: { id: 'pending', threadId: 'concept-owner', kind } },
        ],
    });
    const part = item({ parentId: parent.id, status: 'Needs you', threads: [] });

    expect(deskWait(part, false, [parent, part]).action).toEqual({ kind: 'thread', label, threadId: 'concept-owner' });
});

test.each(['single', 'linked'] as const)('a failed %s launch reaches the desk and keeps its place', (flow) => {
    const work = item({
        flow,
        status: 'Shaping',
        needsYou: {
            reason: 'T3 shows no thread',
            offers: ['start-again'],
            causes: [{ type: 'no-thread' }],
            ticketOpen: true,
            startAgainPurpose: 'shape',
        },
    });

    expect(placementOf(work, { all: [work], unavailable: false }).sections).toEqual([
        'desk',
        flow === 'linked' ? 'dock' : 'shaping',
    ]);
    expect(deskWait(work)).toEqual({ label: 'Start failed', action: { kind: 'start-again', label: 'Start again' } });
});

test('a brief gate gets a short notice while ordinary questions retain their question', () => {
    const work = item({
        threads: [
            {
                ...stopped,
                state: 'needs you',
                questionSummary: '## What\nA full brief with `code` and long details.',
                pendingRequest: { id: 'gate', threadId: 'shape', kind: 'brief-approval' },
            },
        ],
    });

    expect(questionWaitReason(work)).toBe('Review the brief below, then approve it or request changes in T3.');
    work.threads = [{ ...stopped, state: 'needs you', questionSummary: 'Which account should own it?' }];
    expect(questionWaitReason(work)).toBe('Which account should own it?');
});

test('a changed brief names its board approval and keeps the active build in Build', () => {
    const work = item({
        status: 'Needs you',
        buildPhase: 'implement',
        briefApproval: { reason: 'The brief changed during Build.' },
        threads: [{ ...stopped, state: 'needs you', pendingRequest: { id: 'q', threadId: 'build', kind: 'question' } }],
    });

    expect(deskWait(work)).toEqual({ label: 'Approve brief', action: { kind: 'details', label: 'Approve brief' } });
    expect(questionWaitReason(work)).toBe('The brief changed during Build.');
    expect(placementOf(work, { all: [work], unavailable: false }).sections).toEqual(['desk', 'build']);
});

test('an unstarted linked child routes its gate to the exact request owner on its parent', () => {
    const parent = item({
        id: 'linked-parent',
        kind: 'feature',
        flow: 'linked',
        threads: [
            {
                ...stopped,
                id: 'parent-shape',
                purpose: 'shape',
                state: 'needs you',
                pendingRequest: { id: 'gate', threadId: 'gate-owner', kind: 'brief-approval' },
            },
        ],
    });
    const child = item({ id: 'child', parentId: parent.id, status: 'Needs you', threads: [] });

    expect(deskWait(child, false, [parent, child])).toEqual({
        label: 'Approve brief',
        action: { kind: 'thread', label: 'Approve brief', threadId: 'gate-owner' },
    });
    for (const threads of ['unavailable', [{ ...stopped, id: 'own', state: 'done' }]] as const) {
        expect(
            deskWait({ ...child, threads: threads === 'unavailable' ? threads : [...threads] }, false, [parent, child])
                .action?.threadId,
        ).not.toBe('gate-owner');
    }
    expect(
        deskWait(child, false, [
            { ...parent, threads: [{ ...(parent.threads as ItemThread[])[0]!, observedAt: 'old' }] },
            child,
        ]).action?.threadId,
    ).not.toBe('gate-owner');
});

test('a board approval reaches desk placement independently of the stored stage', () => {
    const work = item({ status: 'In progress', threads: [], briefApproval: { reason: 'Review the complete brief.' } });

    expect(placementOf(work, { all: [work], unavailable: false }).sections).toContain('desk');
    expect(deskWait(work)).toEqual({ label: 'Approve brief', action: { kind: 'details', label: 'Approve brief' } });
});
