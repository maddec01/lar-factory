// The board search as the page shows it: the dialog that sets Kind and Labels and opens tickets.

import type { BoardData, Item } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, mountPage, sample, settle, text, fetchMock, toast } from '@/test/PageTest';

const base = sample.items.find((i) => i.id === 'I_sample05')!;
const item = (id: string, change: Partial<Item>): Item => ({ ...base, id, labels: [], labelColors: {}, ...change });
const withItems = (items: Item[]): BoardData => ({ ...sample, items });

const field = () => $<HTMLButtonElement>('[data-search-field]')!;
const dialog = () => $('[data-command-palette]');
const input = () => $<HTMLInputElement>('[data-command-palette] input')!;
const openDialog = () => settle(() => field().click());
const press = (key: string, modifiers: KeyboardEventInit = {}) =>
    settle(() =>
        document.activeElement!.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
        ),
    );
const type = (value: string) =>
    settle(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
        input().dispatchEvent(new Event('input', { bubbles: true }));
    });
const option = (name: string) =>
    $$<HTMLElement>('[data-command-palette] [role="option"]').find((o) => text(o.querySelector('.flex-1')) === name)!;
const choose = (name: string) => settle(() => option(name).click());
/** Lets a closed dialog's return of the focus run, which Radix leaves to the next task. */
const returnFocus = () => settle(() => vi.advanceTimersByTime(0));

const WIDE: BoardData = withItems([
    item('K1', { number: 1, title: 'Match kept', kind: 'bug' }),
    item('H1', { number: 2, title: 'Match hidden', kind: 'feature' }),
]);

test('choosing a ticket closes the dialog and opens its item dialog, which returns the focus to the field', async () => {
    await mountPage(WIDE);

    const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

    await openDialog();
    await type('#2');
    await choose('#2 Match hidden');
    expect(dialog()).toBeNull();
    expect(useItemDialogStore.getState().itemId).toBe('H1');
    await returnFocus();
    expect($('[data-item-dialog]')!.contains(document.activeElement)).toBe(true);
    await press('Escape');
    await returnFocus();
    expect(document.activeElement).toBe(field());
});

test('a shaping close announces its reason once and stays searchable and readable in Archive', async () => {
    const shaping = item('closed-47', { number: 47, title: 'Trim greeting', status: 'Shaping' });
    const closed = {
        ...shaping,
        setAside: true,
        closeReason: 'as already fixed on main @88490ab',
        archived: { setAside: true, hidden: false, ticketOpen: false },
    };

    await mountPage(withItems([shaping]));

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

    let archiveAvailable = false;

    fetchMock.mockImplementation(async (url: string) =>
        url === '/api/archive' && !archiveAvailable
            ? new Response('', { status: 503 })
            : new Response(JSON.stringify(url === '/api/archive' ? { items: [closed] } : withItems([]))),
    );
    await settle(() => useBoardStore.getState().receive(withItems([])));
    expect(toast()).toBeNull();
    archiveAvailable = true;
    // An identical snapshot retries the failed Archive read.
    await settle(() => useBoardStore.getState().receive(withItems([])));
    expect(text(toast())).toBe('Closed #47 as already fixed on main @88490ab. View item');
    await settle(() => $<HTMLButtonElement>('[data-view-item]')!.click());
    expect(useItemDialogStore.getState().itemId).toBe('closed-47');
    expect(text($('[data-item-summary]'))).toContain('Closed as already fixed');
    await settle(() => useItemDialogStore.getState().close());
    await openDialog();
    await type('#47');
    expect(text(dialog())).toContain('Archive');
    expect(text(dialog())).toContain('Closed as already fixed on main @88490ab');
    await choose('#47 Trim greeting');
    expect(useItemDialogStore.getState().itemId).toBe('closed-47');

    // Repeated snapshots do not repeat the announcement.
    const { clearToast } = await import('@/features/notices/ToastActions');

    await settle(() => clearToast('closed:closed-47'));
    await settle(() => useBoardStore.getState().receive(withItems([])));
    expect(toast()).toBeNull();
});
