// Toasts: a success clears itself after 5 s, later while it's in use; the close button; View item;
// shown through the design system's Toaster. Ported from the toast cases of test/render.test.ts.

import { expect, test, vi } from 'vite-plus/test';
import { $, fetchMock, mountPage, moved, sample, settle, text, toast } from '../../test/support.ts';

/** Shows a toast straight from the store, as the Add item form will. */
async function notify(notice: Parameters<typeof import('./notices.tsx').notify>[0]): Promise<void> {
  const { notify } = await import('./notices.tsx');
  await settle(() => notify(notice));
}

test('a success toast clears itself after 5 s', async () => {
  await mountPage();
  await notify({ verb: 'Moved', item: sample.items[0]!, to: 'Queued' });
  expect(toast()).not.toBeNull();
  await settle(() => vi.advanceTimersByTime(4_900));
  expect(toast()).not.toBeNull();
  await settle(() => vi.advanceTimersByTime(100));
  expect(toast()).toBeNull();
});

test('a toast with focus stays, then gets a full 5 s once focus leaves', async () => {
  await mountPage();
  await notify({ verb: 'Moved', item: sample.items[0]!, to: 'Queued' });
  toast()!.querySelector<HTMLElement>('.view-item')!.focus();
  await settle(() => vi.advanceTimersByTime(8_000));
  expect(toast(), 'still being used').not.toBeNull();
  (document.activeElement as HTMLElement).blur();
  await settle(() => vi.advanceTimersByTime(5_500));
  expect(toast()).not.toBeNull();
  await settle(() => vi.advanceTimersByTime(1_000));
  expect(toast()).toBeNull();
});

test('a new notice replaces the last, and its close button closes it', async () => {
  await mountPage();
  const [first, second] = [sample.items[0]!, sample.items[1]!];
  await notify({ verb: 'Added', item: first, to: 'List' });
  expect(text(toast())).toBe(`Added #61 ${first.title} to List. View item`);
  await notify({ verb: 'Moved', item: second, to: 'Queued' });
  expect(document.querySelectorAll('[data-toast]').length).toBe(1);
  expect(text(toast())).toMatch(/^Moved #114 /);
  const close = toast()!.querySelector<HTMLButtonElement>('button.dismiss')!;
  close.focus();
  await settle(() => close.click());
  expect(toast()).toBeNull();
  expect(document.activeElement, 'focus stays on the page').toBe($('.add-item'));
});

test('toasts in different slots each show, a failure as an alert', async () => {
  await mountPage();
  const { showToast } = await import('./toasts.tsx');
  await settle(() => showToast({ slot: 'update', failed: true, what: 'Update failed', body: 'Update failed' }));
  await notify({ verb: 'Added', item: sample.items[0]!, to: 'List' });
  expect(document.querySelectorAll('[data-toast]').length).toBe(2);
  expect(document.querySelector('[data-toast="update"]')!.closest('[data-slot="toast"]')!.getAttribute('role')).toBe('alert');
  expect(document.querySelector('[data-toast="notice"]')!.closest('[data-slot="toast"]')!.getAttribute('role')).toBe('status');
});

test('a failure stays until it is closed', async () => {
  await mountPage();
  const { showToast } = await import('./toasts.tsx');
  await settle(() => showToast({ slot: 'update', failed: true, what: 'Update failed', body: 'Update failed' }));
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(toast()).not.toBeNull();
});

test('View item opens the item in the item dialog and closes the toast', async () => {
  await mountPage();
  await notify({ verb: 'Added', item: sample.items[0]!, to: 'List' });
  await settle(() => toast()!.querySelector<HTMLButtonElement>('.view-item')!.click());
  const { useItemDialogStore } = await import('../item-dialog/item-dialog-store.ts');
  expect(useItemDialogStore.getState().itemId).toBe('I_sample01');
  expect($('[data-item-dialog]')!.textContent).toContain(sample.items[0]!.title);
  expect(toast()).toBeNull();
});

test('View item does nothing once the item has left the board', async () => {
  await mountPage();
  await notify({ verb: 'Added', item: { ...sample.items[0]!, id: 'I_gone' }, to: 'List' });
  await settle(() => toast()!.querySelector<HTMLButtonElement>('.view-item')!.click());
  expect($('[data-item-dialog]')).toBeNull();
  expect(toast(), 'the toast stays').not.toBeNull();
});

test("a poll that started before the page's own write doesn't bring back older data", async () => {
  await mountPage();
  let answerPoll!: () => void;
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/board') return new Promise<Response>((resolve) => (answerPoll = () => resolve(new Response(JSON.stringify(sample)))));
    return new Response(JSON.stringify({ error: null, board: moved('I_sample01', 'Queued') }));
  });
  await settle(() => vi.advanceTimersByTime(15_000));
  const { useItemDialogStore } = await import('../item-dialog/item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open('I_sample01'));
  await settle(() => $<HTMLButtonElement>('[data-item-dialog] [data-queue="I_sample01"]')!.click());
  const inList = () => text($('.title-bar .list-button'));
  expect(inList()).toBe('List3');
  await settle(() => answerPoll());
  expect(inList(), 'still Queued').toBe('List3');
});

test('a build start announces the outcome and links the thread without printing its prompt or id', async () => {
  await mountPage();
  await notify({ verb: 'Started', item: sample.items.find((i) => i.number === 140)!, kind: 'build', thread: {
    threadId: 'raw-thread-id', title: 'Build owner/repo#140. Read /Users/example/private-checkout and follow the builder instructions.',
  } });
  expect(text(toast())).toBe('Build started for #140. Open thread');
  expect(toast()!.querySelector('a')!.getAttribute('href')).toBe('t3code://threads/sample-environment/raw-thread-id');
});

test('notifications sit at the top of the page, away from dialog footer actions', async () => {
  await mountPage();
  await notify({ verb: 'Moved', item: sample.items[0]!, to: 'Queued' });
  const viewport = $('[data-slot="toaster"]')!;
  expect(viewport.classList.contains('top-0')).toBe(true);
  expect(viewport.classList.contains('bottom-0')).toBe(false);
});
