// Toasts: a success clears itself after 5 s, later while it's in use; the close button; View item;
// shown through the design system's Toaster. Ported from the toast cases of test/render.test.ts.

import { expect, test, vi } from 'vite-plus/test';

import { $, fetchMock, mountPage, moved, sample, settle, text, toast } from '@/test/PageTest';

/** Shows a toast straight from the store, as the Add item form will. */
async function notify(notice: Parameters<typeof import('./Notices').notify>[0]): Promise<void> {
    const { notify } = await import('./Notices');

    await settle(() => notify(notice));
}

test('View item opens the item in the item dialog and closes the toast', async () => {
    await mountPage();
    await notify({ verb: 'Added', item: sample.items[0]!, to: 'List' });
    await settle(() => toast()!.querySelector<HTMLButtonElement>('[data-view-item]')!.click());

    const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

    expect(useItemDialogStore.getState().itemId).toBe('I_sample01');
    expect($('[data-item-dialog]')!.textContent).toContain(sample.items[0]!.title);
    expect(toast()).toBeNull();
});

test('a poll that started before the page’s own write doesn’t bring back older data', async () => {
    await mountPage();

    let answerPoll!: () => void;

    fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/board')
            return new Promise<Response>(
                (resolve) => (answerPoll = () => resolve(new Response(JSON.stringify(sample)))),
            );

        return new Response(JSON.stringify({ error: null, board: moved('I_sample01', 'Queued') }));
    });
    await settle(() => vi.advanceTimersByTime(15_000));

    const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open('I_sample01'));
    await settle(() => $<HTMLButtonElement>('[data-item-dialog] [data-queue="I_sample01"]')!.click());

    const inList = () => text($('.title-bar .list-button'));

    expect(inList()).toBe('List3');
    await settle(() => answerPoll());
    expect(inList(), 'still Queued').toBe('List3');
});
