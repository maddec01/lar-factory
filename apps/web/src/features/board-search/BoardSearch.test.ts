// The board search as the page shows it: the dialog that sets Kind and Labels and opens tickets.

import type { BoardData, Item } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, mountPage, sample, settle, text } from '@/test/PageTest';

const FILTERS_KEY = 'lar-board:filters:board';
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
const removes = () => $$('[data-command-palette] li button').map((button) => button.getAttribute('aria-label'));
const saved = () => JSON.parse(localStorage.getItem(FILTERS_KEY)!) as unknown;
const queue = () => $$<HTMLLIElement>('[data-stage="queue"] ol > li').map((row) => row.dataset.item);
/** Lets a closed dialog's return of the focus run, which Radix leaves to the next task. */
const returnFocus = () => settle(() => vi.advanceTimersByTime(0));

test('choosing a kind or label toggles its token, saves it and keeps the dialog open', async () => {
    await mountPage(
        withItems([
            item('Q1', { number: 1, kind: 'feature', labels: ['docs'] }),
            item('Q2', { number: 2, kind: 'bug', labels: ['area: web'] }),
        ]),
    );
    await openDialog();
    await choose('Bug');
    expect(queue()).toEqual(['Q2']);
    expect(saved()).toEqual({ kinds: ['bug'], labels: [] });
    await choose('docs');
    expect(queue()).toEqual([]);
    expect(removes()).toEqual(['Remove Bug', 'Remove docs']);
    expect(option('Bug').getAttribute('aria-checked')).toBe('true');
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(input());
    await choose('Bug');
    await choose('docs');
    expect(queue()).toEqual(['Q1', 'Q2']);
    expect(removes()).toEqual([]);
});

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
