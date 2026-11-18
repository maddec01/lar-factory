import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import { placementOf } from './board-view.ts';
import { deskWait, reconcileGroupWaits } from './desk-wait.ts';
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
        { met: { by: 'User', at: 'now' } },
        { observation: { ...dependency.observation, kind: 'reopened' as const } },
    ]) {
        const cleared = { ...work, blockers: [{ ...work.blockers[0]!, dependency: { ...dependency, ...change } }] };

        expect(placementOf(cleared, { all: [cleared], unavailable: false }).sections).not.toContain('desk');
    }
});

test('PR review is one desk wait through checks, conflicts and legacy Verify', () => {
    const retro = {
        pr: 'owner/repo#1',
        suggestions: [
            { title: 'Help', description: 'Clarify', repository: 'owner/repo', kind: 'improvement' as const },
        ],
        choice: null,
        captures: [{ requestId: 'capture', ticketRequestId: 'ticket', workId: null, error: null, complete: false }],
    };
    const ready = item({ status: 'Ready to merge', retro });
    const pr = ready.linkedPrs[0]!;

    expect(deskWait(ready).label).toBe('Choose follow-ups');
    expect(deskWait(item({ status: 'Ready to merge' })).label).not.toBe('Choose follow-ups');
    expect(deskWait(item({ status: 'Verify', retro })).label).toBe('Review PR');
    expect(
        deskWait({
            ...ready,
            retro: undefined,
            linkedPrs: [{ ...pr, checks: { passed: 0, failed: 1, running: 0, total: 1, since: null } }],
        }).label,
    ).toBe('Review PR');
    expect(deskWait({ ...ready, retro: undefined, linkedPrs: [{ ...pr, mergeState: 'conflicts' }] }).label).toBe(
        'Review PR',
    );
    expect(deskWait(item({ status: 'Done', linkedPrs: [{ ...pr, state: 'merged' }], retro })).label).toBe(
        'Choose follow-ups',
    );
});

const pending = (key: string, changes: string[], requiresFix = false) =>
    ({ key, digest: key, kind: 'map', workId: 'part', summary: key, changes, requiresFix }) as const;
const group = (items: ReturnType<typeof pending>[], patch: Partial<Item> = {}) =>
    item({
        flow: 'linked',
        linkedPrs: [],
        reconciliation: { groupId: 'group', digest: 'd', items, completed: [], pending: items },
        ...patch,
    });

test('group reconciliation stays off the desk and waits for live part owners', () => {
    const work = group([pending('map:part', ['brief', 'status'])], { id: 'group' });
    const part = item({ id: 'part', parentId: work.id, threads: [{ ...stopped, state: 'running' }] });

    expect(reconcileGroupWaits(work)).toBe(true);
    expect(placementOf(work, { all: [work], unavailable: false }).sections).not.toContain('desk');
    expect(reconcileGroupWaits(work, [work, part])).toBe(false);
    part.threads = [{ ...stopped, state: 'done', hasRunningChildren: true }];
    expect(reconcileGroupWaits(work, [work, part])).toBe(false);
    part.threads = [{ ...stopped, state: 'done', observedAt: '2026-11-17' }];
    expect(reconcileGroupWaits(work, [work, part])).toBe(false);
    part.threads = [{ ...stopped, state: 'done' }];
    expect(reconcileGroupWaits(work, [work, part])).toBe(true);
    expect(reconcileGroupWaits(group([pending('map:part', ['status', 'finishedAt'])]))).toBe(false);
    expect(reconcileGroupWaits(group([pending('outcome:group', [], true)]))).toBe(false);
});

test('a pending release step at the last merge shows Release step, not Reconcile group', () => {
    const work = group([pending('map:part', ['brief'])], {
        releasePlan: {
            steps: [{ id: 'activate', who: 'User', what: 'Activate', shipsWith: [], done: null }],
            outcomeCheck: { what: 'Check', result: 'pending', evidence: null },
        } as unknown as Item['releasePlan'],
    });

    expect(deskWait(work).label).toBe('Release step');
});

test('new PR runs leave CI failures and conflicts with T3 unless it raises a human notice', () => {
    const work = item({
        status: 'Ready to merge',
        verification: { prReview: true, required: false, head: null, latest: null, resume: null },
    });

    for (const pr of [
        {
            ...work.linkedPrs[0]!,
            mergeState: 'blocked' as const,
            checks: { passed: 0, failed: 1, running: 0, total: 1, since: null },
        },
        { ...work.linkedPrs[0]!, mergeState: 'conflicts' as const },
    ]) {
        const fixing = { ...work, linkedPrs: [pr] };

        expect(placementOf(fixing, { all: [fixing], unavailable: false }).sections).not.toContain('desk');
    }

    expect(
        placementOf(
            {
                ...work,
                linkedPrs: [
                    {
                        ...work.linkedPrs[0]!,
                        checks: { passed: 1, failed: 1, running: 0, total: 2, since: null },
                        mergeState: 'can merge',
                    },
                ],
            },
            { all: [work], unavailable: false },
        ).sections,
    ).toContain('desk');

    const gaveUp = {
        ...work,
        needsYou: { reason: 'CI fixer could not repair the job.', offers: [], causes: [], ticketOpen: true },
    } as Item;

    expect(placementOf(gaveUp, { all: [gaveUp], unavailable: false }).sections).toContain('desk');
});

test('a terminal PR never creates a review task from a stale workflow status', () => {
    for (const status of ['Verify', 'Ready to merge'] as const) {
        for (const state of ['merged', 'closed'] as const) {
            const work = item({ status });

            work.linkedPrs = [{ ...work.linkedPrs[0]!, state }];
            expect(placementOf(work, { all: [work], unavailable: false }).sections).not.toContain('desk');
        }
    }
});
