import type { BoardData, Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, NOW, fresh, mountPage, sample, settle, text } from '@/test/PageTest';

const build = (running = true): Item => ({
    ...sample.items.find((item) => item.status === 'In progress')!,
    id: 'tidy-build',
    title: 'A build with activity and a PR',
    kind: 'feature',
    flow: 'single',
    parent: null,
    parentId: null,
    status: 'In progress',
    buildPhase: 'implement',
    slices: [],
    threads: [
        {
            id: 'owner',
            title: 'Owner',
            purpose: 'build',
            state: running ? 'running' : 'done',
            currentRunning: running ? true : undefined,
            updated: new Date(NOW - 720_000).toISOString(),
            activity: {
                available: true,
                readAt: new Date(NOW).toISOString(),
                action: 'Approver running with a long activity description',
                actionAt: new Date(NOW - (running ? 6_000 : 720_000)).toISOString(),
                toolRunning: false,
                agents: running ? [{ title: 'Approver', action: 'Review' }] : [],
            },
        },
    ],
    linkedPrs: [{ ...sample.items.find((item) => item.linkedPrs.length)!.linkedPrs[0]!, number: 34 }],
});
const board = (items: Item[]): BoardData => fresh({ ...sample, items });
const row = () => $('[data-stage="build"] [data-item="tidy-build"]')!;

test('a mounted Build row keeps long activity available in a title and lets its metadata wrap beside a PR', async () => {
    await mountPage(board([build()]));

    const activity = row().querySelector<HTMLElement>('[data-activity]')!;

    expect(activity.title).toContain('Approver running with a long activity description');
    expect(activity.classList.contains('flex-wrap')).toBe(true);
    expect(text(row().querySelector('[data-col="pr"]'))).toContain('PR #34');
});

test('an ended owner turn in an unfinished build shows quiet elapsed activity, then clears it on a live push', async () => {
    await mountPage(board([build(false)]));
    expect(text(row().querySelector('[data-activity="quiet"]'))).toBe('No action for 12m');
    expect(text(row().querySelector('[data-col="state"] [data-state]'))).toBe('Idle');
    expect(text($('.desk'))).toContain('Nothing waits on you.');

    const { useItemDialogStore } = await import('@/features/item-dialog');

    await settle(() => useItemDialogStore.getState().open('tidy-build'));
    expect(text($('[data-item-summary]'))).toContain('Idle');
    expect(text($('[data-item-summary]'))).not.toContain('Implementing');

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() => useBoardStore.getState().receive(board([build()])));
    expect(row().querySelector('[data-activity="quiet"]')).toBeNull();
    expect(text(row().querySelector('[data-col="state"] [data-state]'))).toBe('Implementing');
    expect(text(row())).toContain('Approver running');
    expect(text($('[data-item-summary]'))).toContain('Implementing');
});

test('a linked parent uses the same Linked work kind on its desk card and group row', async () => {
    const parent: Item = {
        ...build(),
        id: 'tidy-parent',
        flow: 'linked',
        releasePlan: { steps: [], outcomeCheck: { what: 'Release works', result: 'pending', evidence: null } },
        outcomeCheck: { ready: true, digest: 'release', run: null },
        threads: [],
    };

    await mountPage(board([parent]));
    expect(text($('.desk-card'))).toContain('Linked work');
    expect(text($('[data-dossier] [data-kind]'))).toBe('Linked work');
});
