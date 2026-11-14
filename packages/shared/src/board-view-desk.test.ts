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

test.each(['concept', 'linked'])('%s batch approval appears once on the parent desk card', (kind) => {
    const parent = work({
        id: 'parent',
        kind: kind === 'concept' ? 'concept' : 'feature',
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
    ['bug', { kind: 'bug' }, []],
    ['feature', { kind: 'feature' }, []],
    ['improvement', { kind: 'improvement' }, []],
    ['build', { kind: 'build' }, []],
    ['concept', { kind: 'concept' }, []],
    ['decision', { kind: 'decision' }, []],
    ['linked parent', { flow: 'linked' }, [work({ id: 'child', parentId: 'work' })]],
    ['concept part', { parentId: 'parent', flow: 'linked' }, [work({ id: 'parent', kind: 'concept' })]],
    ['linked part', { parentId: 'parent', flow: 'linked' }, [work({ id: 'parent' })]],
    [
        'decision part',
        { kind: 'decision', parentId: 'parent', flow: 'linked' },
        [work({ id: 'parent', kind: 'concept' })],
    ],
];
const waits: [string, Partial<Item>, boolean][] = [
    ['question during a build', { threads: [question] }, true],
    ['tool approval', { threads: [question], status: 'Review' }, true],
    ['brief gate approval', { needsYou: notice, status: 'Shaping' }, true],
    ['saved question', { status: 'Needs you' }, true],
    ['Verify', { status: 'Verify' }, true],
    ['PR to merge', { status: 'Ready to merge' }, true],
    ['slice question owned by its build', { threads: [{ id: 'build', childNeedsYou: true } as ItemThread] }, true],
    ['agent running', { threads: [{ id: 'build', state: 'running', currentRunning: true } as ItemThread] }, false],
    ['Ready', { status: 'Ready' }, false],
    ['ordinary blocker', { blockers: [{ state: 'open' }] as Item['blockers'] }, false],
    ['unmet prerequisite', { slices: [{ progress: 'blocked' }] as Item['slices'] }, false],
    ['unknown activity', { threads: 'unavailable' }, false],
    ['old question', { threads: [{ ...question, observedAt: '2026-11-01' }] }, false],
    [
        'old slice question',
        { threads: [{ ...question, state: 'done', childNeedsYou: true, observedAt: '2026-11-01' }] },
        false,
    ],
    ['answered question', { threads: [{ ...question, state: 'done' }] }, false],
    [
        'CI running',
        {
            status: 'Ready to merge',
            linkedPrs: [{ state: 'open', checks: { running: 1, failed: 0 } }] as Item['linkedPrs'],
        },
        false,
    ],
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

test('parent identity uses current board data, falls back to the ticket, and names local unticketed work', () => {
    const parent = work({ id: 'parent', number: 0, title: 'Local parent' });
    const child = work({
        parentId: parent.id,
        parent: {
            number: 9,
            title: 'Ticket parent',
            repo: 'elsewhere/project',
            url: 'https://example.com/9',
            state: 'open',
        },
    });

    expect(deskParentName(child, [parent, child])).toBe('Local parent');
    expect(deskParentName(child, [child])).toBe('#9 Ticket parent');
    expect(deskParentName(work(), [])).toBeUndefined();
});

test('a ready Pedro release step is a desk wait; an agent step and later human steps are not', () => {
    const plan = {
        steps: [{ id: 'activate', who: 'Pedro', what: 'Activate', done: null }],
        outcomeCheck: { what: 'Check composition', result: 'pending' as const, evidence: null },
    };
    const parent = work({ flow: 'linked', releasePlan: plan });

    expect(deskItems({ items: [parent] }, false)).toEqual([parent]);
    expect(deskWait(parent)).toEqual({
        label: 'Release step',
        action: { kind: 'details', label: 'Mark release step done' },
    });
    expect(
        deskItems(
            {
                items: [
                    work({ releasePlan: { ...plan, steps: [{ ...plan.steps[0]!, who: 'Agent' }, ...plan.steps] } }),
                ],
            },
            false,
        ),
    ).toEqual([]);
    expect(
        deskItems(
            {
                items: [
                    work({
                        releasePlan: {
                            ...plan,
                            steps: [{ ...plan.steps[0]!, done: { by: 'Pedro', at: 'now', evidence: 'Activated.' } }],
                        },
                    }),
                ],
            },
            false,
        ),
    ).toEqual([]);
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

test('Outcome is an agent wait until a failed check, dispatch failure or owner ending without evidence', () => {
    const parent = work({
        id: 'parent',
        kind: 'concept',
        outcomeCheck: {
            ready: true,
            digest: 'input',
            run: {
                digest: 'input',
                ownerWorkId: 'parent',
                threadId: 'owner',
                commandId: 'command',
                messageId: 'message',
                requestedAt: '2026-11-14T10:00:00Z',
                sent: true,
                error: null,
            },
        },
        releasePlan: { steps: [], outcomeCheck: { what: 'Check composition', result: 'pending', evidence: null } },
        threads: [{ id: 'owner', state: 'running', updated: '2026-11-14T10:01:00Z' } as ItemThread],
    });

    expect(deskItems({ items: [parent] }, false)).toEqual([]);
    parent.threads = [{ id: 'owner', state: 'done', updated: '2026-11-14T09:59:00Z' } as ItemThread];
    expect(deskItems({ items: [parent] }, false)).toEqual([]);
    parent.threads[0]!.updated = '2026-11-14T10:01:00Z';
    expect(deskItems({ items: [parent] }, false)).toEqual([parent]);
    expect(deskWait(parent, false, [parent]).action?.label).toBe('Record Outcome');
    parent.threads[0]!.queued = true;
    expect(deskItems({ items: [parent] }, false)).toEqual([]);
    parent.threads[0]!.queued = undefined;
    parent.threads[0]!.hasLiveChildren = true;
    expect(deskItems({ items: [parent] }, false)).toEqual([]);
    parent.threads = 'unavailable';
    parent.outcomeCheck!.run!.error = 'T3 refused the command';
    expect(deskItems({ items: [parent] }, false)).toEqual([parent]);
});

test('a batch suppresses member approvals while preserving an unrelated member tool request', () => {
    const parent = work({ id: 'parent', kind: 'concept', needsYou: notice });
    const part = work({
        id: 'part',
        kind: 'build',
        parentId: parent.id,
        passingBrief: false,
        briefApproval: { reason: 'Approve brief' },
        threads: [{ ...question, pendingRequest: { id: 'tool', threadId: 'question', kind: 'tool-approval' } }],
    });
    const all = [parent, part];

    expect(deskItems({ items: all }, false)).toEqual(all);
    expect(deskWait(parent, false, all).label).toBe('Approve briefs');
    expect(deskWait(part, false, all).label).toBe('Approval in T3');
});
