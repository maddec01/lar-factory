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

test('Queue shows the action in flight and holds Abandon without relabelling it, then says so', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample01');
  await press(button('queue', 'I_sample01'));
  const queuing = button('queue', 'I_sample01');
  expect([text(queuing), queuing.getAttribute('aria-disabled'), queuing.getAttribute('aria-label')]).toEqual(['Queuing…', 'true', `Queuing… #61 ${sample.items[0]!.title}`]);
  expect(button('abandon', 'I_sample01').getAttribute('aria-disabled'), 'the item is held').toBe('true');
  expect(text(button('abandon', 'I_sample01')), 'Abandon is not relabelled').toBe('Abandon');

  await answer({ error: null, board: moved('I_sample01', 'Queued') });
  expect($('.sidebar [data-item="I_sample01"]'), 'it leaves the List').toBeNull();
  expect([toast()!.getAttribute('role'), text(toast())]).toEqual(['status', `Moved #61 ${sample.items[0]!.title} to Queued. View item`]);
  expect(toast()!.querySelector('button.dismiss')!.getAttribute('aria-label')).toBe('Dismiss: Moved #61');
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
  expect([text(back), back.getAttribute('aria-label')!.split(' ').slice(0, 2).join(' '), back.getAttribute('aria-disabled')]).toEqual(['← Moving to List…', 'Moving #129', 'true']);
  expect(text(button('abandon', 'I_sample05')), 'Abandon is not relabelled').toBe('Abandon');
  expect(text(button('start', 'I_sample05')), 'Start is not relabelled').toBe('Start refining ▾');
});

test('a failed Back to List shows as a toast naming the item, which stays until closed and hands focus back', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample05');
  await press(button('back-to-list', 'I_sample05'));
  await answer({ error: 'Could not set List. GitHub is down.' }, 502);
  expect(toast()!.getAttribute('role')).toBe('alert');
  expect(toast()!.dataset.tone, 'a failure\'s dot is red').toBe('error');
  expect(text(toast())).toMatch(/^Couldn't move #129 .* to List\. Could not set List\. GitHub is down\.$/);
  expect(toast()!.querySelector('a.title'), 'it links the item').not.toBeNull();
  expect($('[data-item-dialog] .action-error'), 'the dialog shows no inline error').toBeNull();
  expect(text(button('back-to-list', 'I_sample05')), 'the footer goes back to its links').toBe('← Back to List');
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(toast(), 'a failure stays').not.toBeNull();
  const close = toast()!.querySelector<HTMLButtonElement>('button.dismiss')!;
  expect(close.getAttribute('aria-label')).toBe('Dismiss: error for #129');
  await press(close);
  expect(toast()).toBeNull();
  expect(document.activeElement, 'back to the button that failed').toBe(button('back-to-list', 'I_sample05'));
});

test('Abandon asks first, naming the issue it deletes or the draft it removes; Cancel returns focus', async () => {
  await mountPage();
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  const dialog = $('#abandon-dialog')!;
  expect(dialog.getAttribute('role')).toBe('alertdialog');
  expect(text($('#abandon-heading'))).toBe(`Delete #61 ${sample.items[0]!.title}?`);
  expect(text($('#abandon-detail'))).toBe("This permanently deletes the issue from maddec01/lar-server on GitHub. It can't be undone.");
  expect($$('#abandon-dialog button').map(text)).toEqual(['Cancel', 'Delete issue']);
  await settle(() => vi.advanceTimersByTime(100));
  expect(document.activeElement, 'Cancel takes focus').toBe($$('#abandon-dialog button')[0]);
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog button')[0]!.click());
  await settle(() => vi.advanceTimersByTime(100));
  expect($('#abandon-dialog')).toBeNull();
  expect(document.activeElement).toBe(button('abandon', 'I_sample01'));
  expect(fetchMock, 'nothing posted').not.toHaveBeenCalled();

  await openItem('I_sample04');
  await press(button('abandon', 'I_sample04'));
  expect(text($('#abandon-heading'))).toMatch(/^Remove draft Shared playback history across devices\?$/);
  expect($$('#abandon-dialog button').map(text)).toEqual(['Cancel', 'Remove draft']);
  await settle(() => vi.advanceTimersByTime(100));
  await settle(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await settle(() => vi.advanceTimersByTime(100));
  expect($('#abandon-dialog'), 'Escape cancels').toBeNull();
  expect($('[data-item-dialog][data-open]'), 'and leaves the item dialog open').not.toBeNull();
});

test('Abandon opens centred on T3\'s backdrop and glass panel, nothing over the title bar drags, and a click outside leaves it open', async () => {
  await mountPage();
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  const { noDrag } = addStylesheet();
  const dialog = $('#abandon-dialog')!;
  const viewport = dialog.closest('[data-slot="alert-dialog-viewport"]')!;
  const backdrop = $('[data-slot="alert-dialog-backdrop"]')!;
  expect(viewport.className).toContain('grid-rows-[1fr_auto_1fr]');
  expect(dialog.classList).toContain('row-start-2');
  expect(dialog.classList).toContain('dialog-glass');
  expect(backdrop.classList).toContain('dialog-backdrop');
  expect([dialog, viewport, backdrop].map(noDrag)).toEqual([true, true, true]);
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    await settle(() => viewport.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0 })));
  }
  await settle(() => vi.advanceTimersByTime(100));
  expect($('#abandon-dialog'), 'still open').not.toBeNull();
});

test('confirming Abandon holds Queue without relabelling it, and announces the deletion without a link', async () => {
  holdPosts();
  const data: BoardData = { ...sample, capture: { enabled: true, session: 'session-1' } as BoardData['capture'] };
  await mountPage(data);
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog button')[1]!.click());
  const abandoning = button('abandon', 'I_sample01');
  expect([text(abandoning), abandoning.getAttribute('aria-disabled')]).toEqual(['Abandoning…', 'true']);
  expect(button('queue', 'I_sample01').getAttribute('aria-disabled')).toBe('true');
  expect(text(button('queue', 'I_sample01')), 'Queue is not relabelled').toBe('Queue');

  await answer({ error: null, board: { ...data, items: data.items.filter((i) => i.id !== 'I_sample01') } });
  expect($('.sidebar [data-item="I_sample01"]')).toBeNull();
  expect(toast()!.querySelector('a, .view-item'), 'nothing to link to').toBeNull();
  expect(posted()).toEqual([['/api/abandon', { session: 'session-1', itemId: 'I_sample01' }]]);
});

test('in sample mode Back to List is disabled too', async () => {
  await mountPage({ ...sample, capture: { enabled: false } as BoardData['capture'] });
  await openItem('I_sample05');
  for (const b of [button('back-to-list', 'I_sample05'), button('abandon', 'I_sample05')]) {
    expect([b.disabled, b.title]).toEqual([true, 'Disabled in sample mode']);
  }
});
