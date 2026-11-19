// Your desk: Needs you, Verify and Ready to merge items and open questions as a grid of cards, each opening the item dialog
// and carrying the buttons for its next action, narrowed by the board's Scope, Kind and Labels; and the line's heading below it.

import type { BoardData, Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, mountPage, sample, settle, text } from '@/test/PageTest';

const card = (id: string) => $(`.desk-row[data-item="${id}"]`)!;
/** Opens a card as a click anywhere on it does: on its row's open button. */
const open = (id: string) => card(id).querySelector<HTMLButtonElement>('[data-row-open]')!.click();
/** The card's next-step line, under its title, past its question and what it belongs to. */
const nextLine = (id: string) =>
    text(card(id).querySelector('[data-desk-more] > :not([data-question], [data-part-of])'));
const dialog = () => $('[data-item-dialog]');
const withItem = (id: string, change: Partial<Item>): BoardData => ({
    ...sample,
    items: sample.items.map((i) => (i.id === id ? { ...i, ...change } : i)),
});

/** Opens a grouped part through the item dialog, where its answer action remains available. */
const openPart = async () =>
    settle(async () => (await import('@/features/item-dialog')).useItemDialogStore.getState().open('I_sample12'));
/** The dialog's last thread action, which answers a question: in the notice that says so, or else the footer's. */
const answerAction = () =>
    [...dialog()!.querySelectorAll<HTMLAnchorElement | HTMLButtonElement>('[data-open-thread]')].at(-1)!;

const questionBoard = (child: Partial<Item> = {}, concept: Partial<Item> = {}): BoardData => ({
    ...sample,
    items: sample.items.map((item) =>
        item.id === 'I_sample09'
            ? {
                  ...item,
                  status: 'Needs you',
                  threads: [
                      {
                          id: 'concept-question',
                          title: 'Concept question',
                          state: 'needs you',
                          updated: '2026-10-21T09:00:00.000Z',
                      },
                  ],
                  ...concept,
              }
            : item.id === 'I_sample12'
              ? { ...item, status: 'Needs you', parentId: 'I_sample09', threads: [], ...child }
              : item,
    ),
});

test('a decision with no thread answers in its concept thread without inheriting its thread association or usage', async () => {
    const data = questionBoard({ stats: undefined });

    await mountPage(data);

    await openPart();

    const action = answerAction() as HTMLAnchorElement;

    expect([text(action), action.href]).toEqual([
        'Answer in concept thread',
        't3code://threads/sample-environment/concept-question',
    ]);

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const child = useBoardStore.getState().data.items.find((item) => item.id === 'I_sample12')!;

    expect(child.threads).toEqual([]);
    expect(child.stats).toBeUndefined();
    expect(card('I_sample09')).not.toBeNull();
    expect(card('I_sample12')).not.toBeNull();
    expect(card('I_sample12').querySelector('[data-open-thread]')?.getAttribute('href')).toBe(action.href);
    expect(text(card('I_sample12'))).toContain('in #200 acme cloud: sign-in and direct connections');
    expect(text(dialog()!.querySelector('[data-open-thread]'))).toBe('Answer in concept thread');
});

test('shaping questions target the older question and leave the desk on a board update', async () => {
    const data = withItem('I_sample12', {
        parentId: null,
        status: 'Shaping',
        threads: [
            { id: 'newer', title: 'Newer', state: 'done', updated: '2026-11-02' },
            { id: 'question', title: 'Question', state: 'needs you', updated: '2026-11-01' },
        ],
    });

    await mountPage(data);
    expect(nextLine('I_sample12'), 'its action says it').toBe('');
    expect(card('I_sample12').querySelector('a')?.getAttribute('href')).toBe(
        't3code://threads/sample-environment/question',
    );
    await settle(() => open('I_sample12'));

    // The footer answers the question as its Main action; the newer thread stays in reach beside it.
    const links = [...dialog()!.querySelectorAll('a[href^="t3code:"]')].map((a) => [text(a), a.getAttribute('href')]);

    expect(text(dialog()!.querySelector('[data-slot="modal-footer"] [data-kind="main"]'))).toBe('Answer in T3');
    expect(links).toContainEqual(['Answer in T3', 't3code://threads/sample-environment/question']);
    expect(
        links.map(([, href]) => href),
        'the newer thread stays in reach',
    ).toContain('t3code://threads/sample-environment/newer');

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore.getState().receive({
            ...data,
            items: data.items.map((item) => (item.id === 'I_sample12' ? { ...item, threads: [] } : item)),
        }),
    );
    expect(card('I_sample12')).toBeNull();
});
