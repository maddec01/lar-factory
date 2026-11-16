// The board after the page's own write: a poll that started before the write never brings back older data.
// Ported from the toast cases of test/render.test.ts.

import { expect, test, vi } from 'vite-plus/test';

import { $, fetchMock, mountPage, moved, sample, settle, text } from '@/test/PageTest';

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

    const inList = () => text($('.title-bar [data-list-button]'));

    expect(inList()).toBe('List19');
    await settle(() => answerPoll());
    expect(inList(), 'still Queued').toBe('List19');
});
