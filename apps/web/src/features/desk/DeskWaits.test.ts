import type { BoardData, Item, ItemThread } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, mountPage, sample, fresh, settle, text, pressMenu } from '@/test/PageTest';

const base = sample.items.find((item) => item.id === 'I_sample12')!;
const thread: ItemThread = {
    id: 'waiting',
    title: 'Shape',
    purpose: 'shape',
    state: 'needs you',
    updated: '2026-10-21T09:00:00Z',
};
const board = (patch: Partial<Item>): BoardData =>
    fresh({ ...sample, items: [{ ...base, parentId: null, flow: 'single', linkedPrs: [], ...patch }] });
const card = () => $('.desk-card')!;

test.each([
    ['question', 'Question', 'Answer in T3'],
    ['brief-approval', 'Approve brief', 'Approve brief'],
    ['tool-approval', 'Tool approval', 'Resolve approval'],
] as const)('the %s card names its wait and links its exact request owner', async (kind, label, action) => {
    await mountPage(
        board({
            status: 'Shaping',
            threads: [{ ...thread, pendingRequest: { id: 'request', threadId: 'child-owner', kind } }],
        }),
    );
    expect(text(card())).toContain(label);

    const link = card().querySelector<HTMLAnchorElement>('[data-open-thread]')!;

    expect(text(link)).toBe(action);
    expect(link.href).toBe('t3code://threads/sample-environment/child-owner');
    expect($('[data-item-dialog]')).toBeNull();
});

test('Verify names and opens the delivery PR', async () => {
    const pr = sample.items.find((item) => item.id === 'I_sample16')!.linkedPrs[0]!;

    await mountPage(board({ status: 'Verify', threads: [], linkedPrs: [pr] }));
    expect(text(card())).toContain('Verify build');

    const link = card().querySelector<HTMLAnchorElement>('[data-pr-link]')!;

    expect([text(link), link.href]).toEqual(['Verify build', pr.url]);
});

test('Merge PR opens the existing guarded confirmation from the desk', async () => {
    const pr = sample.items.find((item) => item.id === 'I_sample16')!.linkedPrs[0]!;

    await mountPage(
        board({
            status: 'Ready to merge',
            threads: [],
            linkedPrs: [
                {
                    ...pr,
                    mergeState: 'can merge',
                    checks: null,
                    checkProgress: undefined,
                    pipelineUnread: undefined,
                    isDraft: false,
                    state: 'open',
                },
            ],
        }),
    );
    expect(text(card())).toContain('Merge PR');

    const button = [...card().querySelectorAll('button')].find((button) => text(button) === 'Merge PR');

    expect(button).toBeDefined();
    await settle(() => button!.click());
    expect(text($('#merge-pr-dialog'))).toContain('Merge');
});

test('a stopped build reaches the desk, keeps its Build row and offers the retry menu', async () => {
    const data = board({
        status: 'In progress',
        buildPhase: null,
        threads: [{ ...thread, purpose: 'build', state: 'stopped' }],
    });

    await mountPage(data);
    expect(text(card())).toContain('Run stopped');
    expect($('[data-stage="build"] [data-item="I_sample12"]')).not.toBeNull();

    const retry = card().querySelector('[data-start]')!;

    expect(text(retry)).toBe('Retry start');
    await pressMenu(retry);
    expect($('[role="menu"]')).not.toBeNull();
    expect(text($('[role="menu"]'))).toContain('Project default');

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore.getState().receive({
            ...data,
            items: data.items.map((item) => ({
                ...item,
                threads: [{ ...thread, purpose: 'build', state: 'running', currentRunning: true }],
            })),
        }),
    );
    expect($('.desk-card')).toBeNull();
});

test.each([
    ['brief-approval', 'Approve brief'],
    ['tool-approval', 'Resolve approval'],
] as const)('a concept part opens its inherited %s from the desk', async (kind, label) => {
    const data = board({ status: 'Needs you', parentId: 'concept', threads: [] });

    data.items.push({
        ...base,
        id: 'concept',
        kind: 'concept',
        status: 'Shaping',
        threads: [{ ...thread, pendingRequest: { id: 'pending', threadId: 'waiting', kind } }],
    });
    await mountPage(data);

    const link = $('.desk-card[data-item="I_sample12"] [data-open-thread]') as HTMLAnchorElement;

    expect([text(link), link.href]).toEqual([label, 't3code://threads/sample-environment/waiting']);
});

test('a failed grouped launch is counted and opens Start again recovery directly from the desk', async () => {
    const data = board({
        flow: 'linked',
        status: 'Shaping',
        threads: [],
        needsYou: {
            reason: 'T3 shows no thread',
            offers: ['start-again', 'set-aside'],
            causes: [{ type: 'no-thread' }],
            ticketOpen: true,
            startAgainPurpose: 'shape',
        },
    });

    await mountPage(data);
    expect(text(card())).toContain('Start failed');
    expect(text($('[data-slot=toolbar-counter]'))).toContain('need you: 1');
    expect($('[data-dossier="I_sample12"]')).not.toBeNull();

    const button = [...card().querySelectorAll('button')].find((button) => text(button) === 'Start again')!;

    await settle(() => button.click());
    expect(text($('#needs-you-dialog'))).toContain('This starts a new shaping thread in T3.');
});

test('linked parent gate ownership and a later notice agree across desk, group and child details', async () => {
    const parent: Item = {
        ...base,
        id: 'linked-parent',
        title: 'Deliver linked greeting',
        kind: 'feature',
        flow: 'linked',
        status: 'In progress',
        parentId: null,
        subIssues: { total: 1, completed: 0 },
        linkedPrs: [],
        threads: [
            {
                ...thread,
                id: 'parent-shape',
                pendingRequest: { id: 'gate', threadId: 'actual-owner', kind: 'brief-approval' },
            },
        ],
    };
    const child: Item = {
        ...base,
        id: 'linked-child',
        title: 'Build the consumer',
        kind: 'build',
        flow: 'linked',
        status: 'Needs you',
        parentId: parent.id,
        subIssues: { total: 0, completed: 0 },
        linkedPrs: [],
        threads: [],
    };

    await mountPage(fresh({ ...sample, items: [parent, child] }));

    const cards = [...document.querySelectorAll('.desk-card')];

    expect(cards).toHaveLength(2);
    for (const entry of cards)
        expect(entry.querySelector<HTMLAnchorElement>('[data-open-thread]')!.href).toBe(
            't3code://threads/sample-environment/actual-owner',
        );

    const group = $(`[data-dossier="${parent.id}"]`)!;

    await settle(() => (group.querySelector('[data-dossier-open]') as HTMLButtonElement).click());
    expect(text(group)).toContain('Approve brief');
    await settle(() => (cards[1]!.querySelector('button') as HTMLButtonElement).click());
    expect($('[data-item-dialog] [data-open-thread]')?.getAttribute('href')).toBe(
        't3code://threads/sample-environment/actual-owner',
    );
});

test('a linked parent notice is the same human wait on the desk and in its group', async () => {
    const parent: Item = {
        ...base,
        id: 'notice-parent',
        title: 'Accepted delivery tracking hold',
        kind: 'feature',
        flow: 'linked',
        status: 'In progress',
        parentId: null,
        subIssues: { total: 1, completed: 1 },
        linkedPrs: [],
        threads: [],
        needsYou: {
            reason: 'Resolve the parent delivery record.',
            offers: ['mark-handled'],
            causes: [],
            ticketOpen: true,
        },
    };

    await mountPage(fresh({ ...sample, items: [parent] }));
    expect(text(card())).toContain('Decision needed');
    expect(text(card())).toContain('Review notice');

    const group = $(`[data-dossier="${parent.id}"]`)!;

    expect(text(group)).toContain('Decision needed');
    expect(text(group)).not.toContain('Nothing waits on you');
    await settle(() => (group.querySelector('[data-dossier-open]') as HTMLButtonElement).click());
    expect(text(group.querySelector('[data-attention-row="you"]'))).toContain('Review notice');
    expect(text(group)).not.toContain('Nothing holds this up');
});
