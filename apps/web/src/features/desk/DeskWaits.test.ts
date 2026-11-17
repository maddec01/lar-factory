import type { BoardData, Item, ItemThread } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, answer, fresh, holdPosts, mountPage, pressMenu, sample, settle, text, toast } from '@/test/PageTest';

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
const card = () => $('.desk-row')!;

test('a brief-approval card names its wait and links its exact request owner', async () => {
    await mountPage(
        board({
            status: 'Shaping',
            threads: [
                { ...thread, pendingRequest: { id: 'request', threadId: 'child-owner', kind: 'brief-approval' } },
            ],
        }),
    );
    expect(text(card())).toContain('Approve brief');

    const link = card().querySelector<HTMLAnchorElement>('[data-open-thread]')!;

    expect(text(link)).toBe('Approve brief');
    expect(link.href).toBe('t3code://threads/sample-environment/child-owner');
    expect($('[data-item-dialog]')).toBeNull();
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
    expect($('.desk-row')).toBeNull();
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

    const cards = [...document.querySelectorAll('.desk-row')];

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

test('a linked batch has one Approve card naming parent and members', async () => {
    const parent = {
        ...base,
        id: 'batch-parent',
        title: 'Greeting delivery',
        parentId: null,
        parent: null,
        kind: 'feature' as const,
        flow: 'linked' as const,
        status: 'Shaping' as const,
        linkedPrs: [],
        threads: [],
        needsYou: { reason: 'Approve the build briefs', offers: [], causes: [], ticketOpen: true },
    };
    const parts = ['Lowercase', 'Trim', 'Length'].map((title) => ({
        ...base,
        id: title,
        title,
        kind: 'build' as const,
        flow: 'linked' as const,
        status: 'Queued' as const,
        parentId: parent.id,
        linkedPrs: [],
        threads: [],
        passingBrief: false,
        briefApproval: { reason: 'Approve brief', digest: title },
    }));

    await mountPage(fresh({ ...sample, items: [parent, ...parts] }));
    expect(document.querySelectorAll('.desk-row')).toHaveLength(1);
    for (const label of ['Greeting delivery', 'Lowercase', 'Trim', 'Length', 'Approve briefs'])
        expect(text(card())).toContain(label);

    const action = [...card().querySelectorAll('button')].find((button) => text(button) === 'Approve briefs')!;

    await settle(() => action.click());

    const { useItemDialogStore } = await import('@/features/item-dialog');

    expect(useItemDialogStore.getState().itemId).toBe(parent.id);
});

test('Reconcile group offers Retry start after a failed start, and a tag in its place once it may have started', async () => {
    holdPosts();

    const pending = [
        {
            key: 'map:part',
            digest: 'd',
            kind: 'map' as const,
            workId: 'part',
            summary: 'Part: reconcile map and affected records (brief).',
            changes: ['brief'],
            requiresFix: false,
        },
    ];
    const data = board({
        status: 'In progress',
        threads: [],
        reconciliation: { groupId: base.id, digest: 'r', items: pending, completed: [], pending },
    });
    const reconcile = () => card().querySelector<HTMLButtonElement>('[data-reconcile-group]');

    await mountPage(data);
    expect(text(reconcile())).toBe('Reconcile group');
    await settle(() => reconcile()!.click());
    await answer({
        thread: null,
        error: 'T3 is unreachable.',
        board: { ...data, startProgress: { [base.id]: { shape: { phase: 'failed', message: 'T3 is unreachable.' } } } },
    });
    expect(text(reconcile())).toBe('Retry start');
    expect(text(toast())).toContain('T3 is unreachable.');
    expect(text(toast())).toContain('Couldn’t start reconciling');
    expect(text(toast())).not.toContain('clear the start error');

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore.getState().receive({
            ...data,
            startProgress: { [base.id]: { shape: { phase: 'may-have-started', message: 'Check T3.' } } },
        }),
    );
    expect(reconcile(), 'no second start').toBeNull();
    expect(text(card().querySelector('.started-tag.unsure'))).toBe('May have started');
});
