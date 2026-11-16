import { describe, expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import { deskItems, deskParentName, placementOf } from './board-view.ts';
import { deskWait } from './desk-wait.ts';
import { nextAction } from './item-next-action.ts';
import type { Item, ItemThread } from './model.ts';

const work = (change: Partial<Item> = {}): Item => ({
    ...(sample.items[0] as Item),
    id: 'work',
    kind: 'issue',
    flow: 'single',
    status: 'In progress',
    parentId: null,
    parent: null,
    threads: [],
    linkedPrs: [],
    ...change,
});
const question = { id: 'question', state: 'needs you' } as ItemThread;
const notice = { reason: 'Approve the brief', offers: [], causes: [], ticketOpen: true };

test('batch eligibility preserves an independent saved notice even when its wording mentions brief approval', () => {
    const parent = work({ id: 'parent', kind: 'concept' });
    const part = work({
        id: 'part',
        parentId: parent.id,
        passingBrief: false,
        briefApproval: { digest: 'current', reason: 'Review current brief' },
        needsYou: { ...notice, reason: 'Repair seed evidence before brief approval.' },
    });
    const all = [parent, part];

    expect(deskItems({ items: all }, false)).toEqual(all);
    expect(deskWait(part, false, all).label).toBe('Decision needed');
    part.needsYou = { ...notice, reason: part.briefApproval!.reason };
    expect(deskItems({ items: all }, false)).toEqual([parent]);
});

test('a batch approval appears once on the parent desk card', () => {
    const parent = work({
        id: 'parent',
        kind: 'concept',
        flow: 'linked',
        needsYou: notice,
    });
    const parts = ['A1', 'A2', 'B1'].map((title) =>
        work({
            id: title,
            title,
            parentId: parent.id,
            kind: 'build',
            status: 'Queued',
            passingBrief: false,
            briefApproval: { digest: title, reason: 'Review current brief' },
        }),
    );
    const all = [parent, ...parts];

    expect(deskItems({ items: all }, false).map((item) => item.id)).toEqual(['parent']);
    expect(deskWait(parent, false, all)).toEqual({
        label: 'Approve briefs',
        action: { kind: 'details', label: 'Approve briefs' },
    });
    for (const part of parts) part.briefApproval = { reason: 'Approve brief', digest: part.id };
    expect(deskItems({ items: all }, false).map((item) => item.id)).toEqual(['parent']);
});

const kinds: [string, Partial<Item>, Item[]][] = [
    ['single issue', {}, []],
    ['concept part', { parentId: 'parent', flow: 'linked' }, [work({ id: 'parent', kind: 'concept' })]],
];
const waits: [string, Partial<Item>, boolean][] = [
    ['question during a build', { threads: [question] }, true],
    ['Verify', { status: 'Verify' }, true],
    ['agent running', { threads: [{ id: 'build', state: 'running', currentRunning: true } as ItemThread] }, false],
    ['old question', { threads: [{ ...question, observedAt: '2026-11-01' }] }, false],
];

for (const [kind, identity, relatives] of kinds) {
    describe(`${kind} desk placement`, () => {
        test.each(waits)('%s', (_name, wait, expected) => {
            const item = work({ ...identity, ...wait });
            const all = [item, ...relatives];
            const sections = placementOf(item, { all, unavailable: false }).sections;
            const grouped = kind === 'concept' || relatives.length > 0;

            expect(sections.includes('desk')).toBe(expected);
            expect(deskItems({ items: all }, false).some((entry) => entry.id === item.id)).toBe(expected);

            if (grouped) expect(sections.filter((section) => section !== 'desk')).toEqual(['dock']);
        });
    });
}

test('a grouped question targets its exact owning thread and does not put quiet relatives on the desk', () => {
    const parent = work({ id: 'parent', kind: 'concept', number: 200, title: 'Cloud sign-in' });
    const child = work({ parentId: parent.id, threads: [{ id: 'newer', state: 'done' } as ItemThread, question] });
    const all = [parent, child, work({ id: 'quiet', parentId: parent.id })];

    expect(deskItems({ items: all }, false)).toEqual([child]);
    expect(nextAction(child)).toEqual({ kind: 'thread', label: 'Answer in T3', threadId: 'question' });
    expect(deskParentName(child, all)).toBe('#200 Cloud sign-in');
});

test('a decision-owned child gate appears once on its build with concept identity, without hiding unrelated questions', () => {
    const parent = work({ id: 'concept', kind: 'concept', number: 0, title: 'Deliver labels' });
    const build = work({
        id: 'build',
        kind: 'build',
        status: 'Needs you',
        parentId: parent.id,
        briefApproval: { reason: 'Approve the exact A1 brief', digest: 'exact-approval-digest' },
    });
    const owner = work({
        id: 'decision',
        kind: 'decision',
        parentId: parent.id,
        threads: [
            {
                ...question,
                questionSummary:
                    'Q6 - A1 final approval: May this exact brief be Ready?\napprovalDigest: exact-approval-digest',
                pendingRequest: { id: 'gate', threadId: 'question', kind: 'question' },
            },
        ],
    });
    const unrelated = work({ id: 'other', threads: [question] });
    const all = [parent, owner, build, unrelated];

    expect(
        deskItems({ items: all }, false)
            .map((item) => item.id)
            .sort(),
    ).toEqual(['build', 'other']);
    expect(deskParentName(build, all)).toBe('Deliver labels');
    expect(deskWait(build, false, all)).toEqual({
        label: 'Approve brief',
        action: { kind: 'details', label: 'Approve brief' },
    });
    owner.threads = [
        {
            ...question,
            state: 'done',
            childNeedsYou: true,
            questionSummary: 'A1 approval: proceed?\napprovalDigest: exact-approval-digest',
            pendingRequest: { id: 'gate', threadId: 'delegate', kind: 'brief-approval' },
        },
    ];
    expect(deskItems({ items: all }, false).map((item) => item.id)).not.toContain('decision');
    owner.threads = [
        {
            ...question,
            questionSummary: 'A1 approval: proceed?\napprovalDigest: different-digest',
            pendingRequest: { id: 'gate', threadId: 'question', kind: 'brief-approval' },
        },
    ];
    expect(deskItems({ items: all }, false).map((item) => item.id)).toContain('decision');
    owner.threads = [{ ...question, questionSummary: 'Which colour should we use?' }];
    expect(deskItems({ items: all }, false).map((item) => item.id)).toContain('decision');
});
