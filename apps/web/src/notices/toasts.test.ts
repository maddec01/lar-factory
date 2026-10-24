// Toasts: a success clears itself after 5 s, later while it's in use; the close button; View item;
// and their place below the header. Ported from the toast cases of test/render.test.ts.

import { expect, test, vi } from 'vite-plus/test';
import { $, fetchMock, mountPage, moved, sample, settle, text, toast } from '../../test/support.ts';

/** Queues the item, which the server moves to Queued, so the page shows a Moved toast. */
async function queue(id: string, board = moved(id, 'Queued')): Promise<void> {
  fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(url === '/api/queue' ? { error: null, board } : sample)));
  await settle(() => $<HTMLButtonElement>(`[data-queue="${id}"]`)!.click());
}

/** Shows a toast straight from the store, as the Add item form will. */
async function notify(notice: Parameters<typeof import('./notices.tsx').notify>[0]): Promise<void> {
  const { notify } = await import('./notices.tsx');
  await settle(() => notify(notice));
}

test('a success toast clears itself after 5 s', async () => {
  await mountPage();
  await queue('PVTI_sample01');
  expect(toast()).not.toBeNull();
  await settle(() => vi.advanceTimersByTime(4_900));
  expect(toast()).not.toBeNull();
  await settle(() => vi.advanceTimersByTime(100));
  expect(toast()).toBeNull();
});

test('a toast with focus stays, then gets a full 5 s once focus leaves', async () => {
  await mountPage();
  await queue('PVTI_sample01');
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

test("a toast swiped away runs the board's close, so focus moves on", async () => {
  await mountPage();
  await notify({ verb: 'Added', item: sample.items[0]!, to: 'List' });
  toast()!.querySelector<HTMLButtonElement>('button.dismiss')!.focus();
  // A swipe closes the toast through coss's toast manager, not through the board's close button.
  const { toastManager } = await import('@mux-factory/ui/toast');
  await settle(() => toastManager.close(toast()!.getAttribute('data-toast-id')!));
  expect(toast()).toBeNull();
  expect(document.activeElement, 'focus stays on the page').toBe($('.add-item'));
});

test('toasts in different slots each keep their own row, not a pile that spreads only on hover', async () => {
  await mountPage();
  const { showToast } = await import('./toasts.tsx');
  await settle(() => showToast({ slot: 'update', failed: true, what: 'Update failed', body: 'Update failed' }));
  await notify({ verb: 'Added', item: sample.items[0]!, to: 'List' });
  expect(document.querySelectorAll('[data-toast]').length).toBe(2);
  // coss's toast marks every toast but the newest as behind and piles them up until hovered.
  expect(document.querySelector('[data-toast="update"] [data-behind]')).not.toBeNull();
});

test('View item shows the item on the Board, opens its List group, moves focus to it and closes the toast', async () => {
  await mountPage();
  await settle(() => $<HTMLButtonElement>('#list-server > [data-slot="collapsible-trigger"]')!.click());
  expect($('#list-server')!.hasAttribute('data-open')).toBe(false);
  await notify({ verb: 'Added', item: sample.items[0]!, to: 'List' });
  await settle(() => toast()!.querySelector<HTMLButtonElement>('.view-item')!.click());
  expect($('#list-server')!.hasAttribute('data-open')).toBe(true);
  const row = $('#list [data-anchor="PVTI_sample01"]')!;
  expect(row.scrollIntoView).toHaveBeenCalled();
  expect(row.classList.contains('anchor-flash')).toBe(true);
  expect(document.activeElement).toBe(row.querySelector('a.row-title'));
  expect(toast()).toBeNull();
});

test("View item goes to the item's own card, not its row inside a concept", async () => {
  await mountPage();
  const sub = sample.items.find((i) => i.id === 'PVTI_sample10')!;
  await notify({ verb: 'Moved', item: sub, to: sub.status });
  await settle(() => toast()!.querySelector<HTMLButtonElement>('.view-item')!.click());
  expect(document.activeElement!.closest('[data-anchor]')!.matches('article')).toBe(true);
});

test('toasts sit below the header while it is on screen, and at the top once it scrolls away', async () => {
  await mountPage();
  let bottom = 100;
  $('header.top')!.getBoundingClientRect = () => ({ bottom }) as DOMRect;
  await notify({ verb: 'Added', item: sample.items[0]!, to: 'List' });
  const anchor = () => document.documentElement.style.getPropertyValue('--toast-anchor');
  expect(anchor()).toBe('100px');
  bottom = -40;
  dispatchEvent(new Event('scroll'));
  expect(anchor()).toBe('0px');
  bottom = 60;
  dispatchEvent(new Event('resize'));
  expect(anchor()).toBe('60px');
});

test('toasts stay below the title bar once the header scrolls away', async () => {
  await mountPage();
  let bottom = 140;
  $('header.top')!.getBoundingClientRect = () => ({ bottom }) as DOMRect;
  $('.title-bar')!.getBoundingClientRect = () => ({ bottom: 52 }) as DOMRect;
  await notify({ verb: 'Added', item: sample.items[0]!, to: 'List' });
  const anchor = () => document.documentElement.style.getPropertyValue('--toast-anchor');
  expect(anchor()).toBe('140px');
  bottom = -40;
  dispatchEvent(new Event('scroll'));
  expect(anchor()).toBe('52px');
});

test("a poll that started before the page's own write doesn't bring back older data", async () => {
  await mountPage();
  let answerPoll!: () => void;
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/board') return new Promise<Response>((resolve) => (answerPoll = () => resolve(new Response(JSON.stringify(sample)))));
    return new Response(JSON.stringify({ error: null, board: moved('PVTI_sample01', 'Queued') }));
  });
  await settle(() => vi.advanceTimersByTime(15_000));
  await settle(() => $<HTMLButtonElement>('[data-queue="PVTI_sample01"]')!.click());
  expect($('#queued [data-anchor="PVTI_sample01"]')).not.toBeNull();
  await settle(() => answerPoll());
  expect($('#queued [data-anchor="PVTI_sample01"]'), 'still Queued').not.toBeNull();
});
