// Queue, Back to List and Abandon from the item dialog: each posts to its endpoint, shows its own pending state,
// then the result as a toast or an error, and keeps focus in the dialog.
// Ported from the card action cases of test/render.test.ts.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, addStylesheet, answer, fetchMock, holdPosts, mountPage, moved, posted, sample, settle, text, toast } from '../../test/support.ts';
import type { BoardData } from '@lar-factory/shared';

const button = (attr: string, id: string) => $<HTMLButtonElement>(`[data-item-dialog] [data-${attr}="${id}"]`)!;
const press = async (el: HTMLElement) => {
  el.focus();
  await settle(() => el.click());
};

/** Opens the item dialog on `itemId` through its store, as every list on the page does. */
async function openItem(itemId: string): Promise<void> {
  const { useItemDialogStore } = await import('../item-dialog/item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(itemId));
}

test('Queue shows pending state, then leaves Shape reachable without an overlay', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample01');
  await press(button('queue', 'I_sample01'));
  const queuing = button('queue', 'I_sample01');
  expect([text(queuing), queuing.getAttribute('aria-disabled'), queuing.getAttribute('aria-label')]).toEqual(['Queuing…', 'true', `Queuing… #61 ${sample.items[0]!.title}`]);
  expect(button('abandon', 'I_sample01').getAttribute('aria-disabled'), 'the item is held').toBe('true');
  expect(text(button('abandon', 'I_sample01')), 'Abandon is not relabelled').toBe('Abandon');

  await answer({ error: null, board: moved('I_sample01', 'Queued') });
  expect(text($('.title-bar .list-button')), 'it leaves the List').toBe('List3');
  expect(toast()).toBeNull();
  expect(text(button('start', 'I_sample01'))).toContain('Shape issue');
});

test("a server that can't be reached is a Queue error too", async () => {
  fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
  await mountPage();
  await openItem('I_sample01');
  await press(button('queue', 'I_sample01'));
  expect(text($('[data-item-dialog] .action-error [role="alert"]'))).toBe("Can't reach the board server. Try again.");
  expect(toast(), 'no toast').toBeNull();
});

test('Back to List shows only its own pending state', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample05');
  const back = button('back-to-list', 'I_sample05');
  await press(back);
  expect([text(back), back.getAttribute('aria-label')!.split(' ').slice(0, 2).join(' '), back.getAttribute('aria-disabled')]).toEqual(['Moving to List…', 'Moving #129', 'true']);
  expect(text(button('abandon', 'I_sample05')), 'Abandon is not relabelled').toBe('Abandon');
  expect(text(button('start', 'I_sample05')), 'Start is not relabelled').toBe('Shape issue ▾');
});

test('a failed Back to List shows as a toast naming the item, which stays until closed and hands focus back', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample05');
  await press(button('back-to-list', 'I_sample05'));
  await answer({ error: 'Could not set List. GitHub is down.' }, 502);
  expect(toast()!.getAttribute('role')).toBe('alert');
  expect(toast()!.dataset.toastColor, 'a failure is red').toBe('danger');
  expect(text(toast())).toMatch(/^Couldn't move #129 .* to List\. Could not set List\. GitHub is down\.$/);
  expect(toast()!.querySelector('a.title'), 'it links the item').not.toBeNull();
  expect($('[data-item-dialog] .action-error'), 'the dialog shows no inline error').toBeNull();
  expect(text(button('back-to-list', 'I_sample05')), 'the footer goes back to its links').toBe('Back to List');
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(toast(), 'a failure stays').not.toBeNull();
  const close = toast()!.querySelector<HTMLButtonElement>('button.dismiss')!;
  expect(close.getAttribute('aria-label')).toBe('Dismiss: error for #129');
  await press(close);
  expect(toast()).toBeNull();
  expect(document.activeElement, 'back to the button that failed').toBe(button('back-to-list', 'I_sample05'));
});

test('Abandon asks first, saying it sets the work aside on this Mac and leaves its ticket open; Cancel returns focus', async () => {
  const warnings = vi.spyOn(console, 'warn');
  await mountPage();
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  const dialog = $('#abandon-dialog')!;
  expect(warnings.mock.calls.filter((args) => args.some((arg) => /Missing.*Description/.test(String(arg))))).toEqual([]);
  expect(dialog.getAttribute('role')).toBe('alertdialog');
  expect(text($('#abandon-dialog h2'))).toBe(`Abandon #61 ${sample.items[0]!.title}?`);
  expect(text(document.getElementById(dialog.getAttribute('aria-describedby')!))).toBe('Abandon sets the work aside on this Mac and leaves its ticket open. Abandon and close ticket closes the ticket first.');
  expect($$('#abandon-dialog [data-slot="modal-footer"] button').map(text)).toEqual(['Cancel', 'Abandon', 'Abandon and close ticket']);
  await settle(() => vi.advanceTimersByTime(100));
  expect(document.activeElement, 'Close takes focus, not the destructive button').toBe($('#abandon-dialog [aria-label="Close"]'));
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[0]!.click());
  await settle(() => vi.advanceTimersByTime(100));
  expect($('#abandon-dialog')).toBeNull();
  expect(document.activeElement).toBe(button('abandon', 'I_sample01'));
  expect(posted(), 'nothing posted').toEqual([]);

  await openItem('I_sample04');
  await press(button('abandon', 'I_sample04'));
  expect(text($('#abandon-dialog h2'))).toMatch(/^Abandon #900004 Shared playback history across devices\?$/);
  expect($$('#abandon-dialog [data-slot="modal-footer"] button').map(text)).toEqual(['Cancel', 'Abandon', 'Abandon and close ticket']);
  await settle(() => vi.advanceTimersByTime(100));
  await settle(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await settle(() => vi.advanceTimersByTime(100));
  expect($('#abandon-dialog'), 'Escape cancels').toBeNull();
  expect($('[data-item-dialog]'), 'and leaves the item dialog open').not.toBeNull();
});

test('Abandon opens over an overlay, nothing over the title bar drags, and a click outside leaves it open', async () => {
  await mountPage();
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  const { noDrag } = addStylesheet();
  const dialog = $('#abandon-dialog')!;
  const overlay = $$('[data-slot="modal-overlay"]').at(-1)!;
  expect(dialog.getAttribute('data-slot')).toBe('modal-content');
  expect([dialog, overlay].map(noDrag)).toEqual([true, true]);
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    await settle(() => overlay.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 })));
  }
  await settle(() => vi.advanceTimersByTime(100));
  expect($('#abandon-dialog'), 'still open').not.toBeNull();
});

test('confirming Abandon holds Queue without relabelling it, and announces the close', async () => {
  holdPosts();
  const data: BoardData = { ...sample, capture: { enabled: true, session: 'session-1' } as BoardData['capture'] };
  await mountPage(data);
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[1]!.click());
  const abandoning = button('abandon', 'I_sample01');
  expect([text(abandoning), abandoning.getAttribute('aria-disabled')]).toEqual(['Abandoning…', 'true']);
  expect(button('queue', 'I_sample01').getAttribute('aria-disabled')).toBe('true');
  expect(text(button('queue', 'I_sample01')), 'Queue is not relabelled').toBe('Queue');

  await answer({ error: null, board: { ...data, items: data.items.filter((i) => i.id !== 'I_sample01') } });
  expect(text($('.title-bar .list-button')), 'it leaves the List').toBe('List3');
  expect(toast()!.querySelector('a, .view-item'), 'the toast gives the result').toBeNull();
  expect(posted()).toEqual([['/api/abandon', { session: 'session-1', itemId: 'I_sample01' }]]);
});

test('in sample mode Back to List is disabled too', async () => {
  await mountPage({ ...sample, capture: { enabled: false } as BoardData['capture'] });
  await openItem('I_sample05');
  for (const b of [button('back-to-list', 'I_sample05'), button('abandon', 'I_sample05')]) {
    expect([b.disabled, b.title]).toEqual([true, 'Disabled in sample mode']);
  }
});

test('queuing a source issue switches the open dialog to its new local work ID', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample01');
  await press(button('queue', 'I_sample01'));
  const board = moved('I_sample01', 'Queued');
  board.items = board.items.map((item) => item.id === 'I_sample01' ? { ...item, id: 'I_imported', recorded: true } : item);
  await answer({ error: null, board, itemId: 'I_imported' });
  const { useItemDialogStore } = await import('../item-dialog/item-dialog-store.ts');
  expect(useItemDialogStore.getState().itemId).toBe('I_imported');
  expect(button('start', 'I_imported')).not.toBeNull();
  expect($('[data-item-dialog] .action-error')).toBeNull();
});

test('combined tracker failure keeps the confirmation open and allows Cancel', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[2]!.click());
  await answer({ error: 'Provider refused closure.' });
  expect(text($('#abandon-dialog [role="alert"]'))).toBe('Provider refused closure.');
  expect($('#abandon-dialog')).not.toBeNull();
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[0]!.click());
  expect($('#abandon-dialog')).toBeNull();
  expect(button('abandon', 'I_sample01')).not.toBeNull();
});

test('board-only failure retains the abandonment confirmation and inline error', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[1]!.click());
  await answer({ error: 'Disk unavailable' });
  expect(text($('#abandon-dialog [role="alert"]'))).toBe('Disk unavailable');
  expect($('#abandon-dialog')).not.toBeNull();
});

test('two lost combined responses block dismissal and board-only recovery until reconciliation', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  const buttons = () => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button');
  await settle(() => buttons()[2]!.click());
  await answer({ error: "Can't reach the board server. Try again." });
  await answer({ error: "Can't reach the board server. Try again." });
  expect(buttons()[0]!.disabled).toBe(true);
  expect(buttons()[1]!.disabled).toBe(true);
  expect(buttons()[2]!.disabled).toBe(false);
  await settle(() => buttons()[2]!.click());
  await answer({ error: 'Provider refused closure.' });
  expect(buttons()[0]!.disabled).toBe(false);
  expect(buttons()[1]!.disabled).toBe(false);
});

test('local retry failure preserves the explanation after tracker closure', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  const buttons = () => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button');
  await settle(() => buttons()[2]!.click());
  await answer({ error: 'The ticket is closed, but the work remains on the board. Try again to finish abandonment. Disk unavailable' });
  await settle(() => buttons()[1]!.click());
  await answer({ error: 'Disk unavailable' });
  expect($('#abandon-dialog')).not.toBeNull();
  expect(text($('#abandon-dialog [role="alert"]'))).toContain('ticket is closed');
});
