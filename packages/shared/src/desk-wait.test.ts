import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import { placementOf } from './board-view.ts';
import { deskWait } from './desk-wait.ts';
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

test('a question names its wait and exact request owner', () => {
    const work = item({
        threads: [
            { ...stopped, state: 'needs you', pendingRequest: { id: 'request', threadId: 'owner', kind: 'question' } },
        ],
    });

    expect(deskWait(work)).toEqual({
        label: 'Question',
        action: { kind: 'thread', label: 'Answer in T3', threadId: 'owner' },
    });
    expect(nextAction(work)).toEqual({ kind: 'thread', label: 'Answer in T3', threadId: 'owner' });
});

test('a stopped build stays in its section and reaches the desk', () => {
    const work = item({ threads: [stopped] });

    expect(placementOf(work, { all: [work], unavailable: false }).sections).toEqual(['desk', 'build']);
    expect(deskWait(work)).toEqual({ label: 'Run stopped', action: { kind: 'retry-build', label: 'Retry start' } });
});

test('unavailable activity cannot put a stopped run on the desk', () => {
    const work = item({ threads: [stopped] });

    expect(placementOf(work, { all: [work], unavailable: true }).sections).not.toContain('desk');
});

test('a failed launch reaches the desk and keeps its place', () => {
    const work = item({
        status: 'Shaping',
        needsYou: {
            reason: 'T3 shows no thread',
            offers: ['start-again'],
            causes: [{ type: 'no-thread' }],
            ticketOpen: true,
            startAgainPurpose: 'shape',
        },
    });

    expect(placementOf(work, { all: [work], unavailable: false }).sections).toEqual(['desk', 'shaping']);
    expect(deskWait(work)).toEqual({ label: 'Start failed', action: { kind: 'start-again', label: 'Start again' } });
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

test('S05 dependency acceptance waits require proof and delivery, and vanish when proof is rejected', () => {
    const dependency = {
        dependencyId: 'proof',
        revision: 11,
        owner: 'external team',
        need: 'Numeric v1 greeting proof',
        ticket: 'fake/c#18',
        named: [],
        evidence: 'Inspected exact fixture and predicate.',
        proofState: 'submitted' as const,
        met: null,
        needsReview: false,
        observation: {
            subject: 'fake/c#18',
            kind: 'closed' as const,
            detail: null,
            observedAt: '2026-11-14T12:26:41.137Z',
            lastGood: null,
        },
    };
    const work = item({
        status: 'Ready',
        linkedPrs: [],
        blockers: [{ number: 18, repo: 'fake/c', state: 'open', dependency }],
    });

    expect(placementOf(work, { all: [work], unavailable: false }).sections).toContain('desk');
    expect(deskWait(work)).toEqual({
        label: 'Accept dependency proof',
        action: { kind: 'details', label: 'Accept dependency proof' },
    });
    for (const change of [
        { evidence: '' },
        { proofState: 'pending' as const },
        { proofState: 'insufficient' as const },
        { proofState: undefined },
        { met: { by: 'Pedro', at: 'now' } },
        { observation: { ...dependency.observation, kind: 'reopened' as const } },
    ]) {
        const cleared = { ...work, blockers: [{ ...work.blockers[0]!, dependency: { ...dependency, ...change } }] };

        expect(placementOf(cleared, { all: [cleared], unavailable: false }).sections).not.toContain('desk');
    }
});
