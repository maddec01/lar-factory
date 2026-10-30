// Toasts: a success clears itself after 5 s, later while it's in use; the close button; View item;
// shown through the design system's Toaster. Ported from the toast cases of test/render.test.ts.

import { expect, test, vi } from 'vite-plus/test';
import type { BoardData } from '@lar-factory/shared';
import { $, $$, addStylesheet, fetchMock, mountPage, moved, sample, settle, text, toast, toolChecks } from '../../test/support.ts';

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
  await settle(() => toast()!.querySelector<HTMLElement>('.view-item')!.focus());
  await settle(() => vi.advanceTimersByTime(8_000));
  expect(toast(), 'still being used').not.toBeNull();
  await settle(() => (document.activeElement as HTMLElement).blur());
  await settle(() => vi.advanceTimersByTime(4_999));
  expect(toast()).not.toBeNull();
  await settle(() => vi.advanceTimersByTime(1));
  expect(toast()).toBeNull();
});

test.each(['focus', 'hover'])('even a brief %s interaction gives a success another full 5 s', async (interaction) => {
  await mountPage();
  await notify({ verb: 'Moved', item: sample.items[0]!, to: 'Queued' });
  const entry = toast()!;
  await settle(() => vi.advanceTimersByTime(1_000));
  await settle(() => interaction === 'focus'
    ? entry.querySelector<HTMLElement>('.view-item')!.focus()
    : entry.dispatchEvent(new MouseEvent('mouseenter')));
  await settle(() => vi.advanceTimersByTime(1_000));
  await settle(() => interaction === 'focus'
    ? (document.activeElement as HTMLElement).blur()
    : entry.dispatchEvent(new MouseEvent('mouseleave')));
  await settle(() => vi.advanceTimersByTime(4_999));
  expect(toast()).not.toBeNull();
  await settle(() => vi.advanceTimersByTime(1));
  expect(toast()).toBeNull();
});

test('a success waits for both hover and focus to leave, including focus moving between its controls', async () => {
  await mountPage();
  await notify({ verb: 'Moved', item: sample.items[0]!, to: 'Queued' });
  const entry = toast()!;
  await settle(() => entry.dispatchEvent(new MouseEvent('mouseenter')));
  await settle(() => vi.advanceTimersByTime(8_000));
  expect(toast(), 'still hovered').not.toBeNull();
  await settle(() => entry.querySelector<HTMLElement>('.view-item')!.focus());
  await settle(() => entry.dispatchEvent(new MouseEvent('mouseleave')));
  await settle(() => vi.advanceTimersByTime(8_000));
  expect(toast(), 'still focused').not.toBeNull();
  await settle(() => entry.querySelector<HTMLButtonElement>('.dismiss')!.focus());
  await settle(() => vi.advanceTimersByTime(8_000));
  expect(toast(), 'focus moved within the toast').not.toBeNull();
  await settle(() => (document.activeElement as HTMLElement).blur());
  await settle(() => vi.advanceTimersByTime(4_999));
  expect(toast()).not.toBeNull();
  await settle(() => vi.advanceTimersByTime(1));
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
  await settle(() => close.focus());
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
  expect($('[data-toast="update"]')!.closest<HTMLElement>('[data-slot="toast"]')!.dataset.toastColor).toBe('danger');
  expect($('[data-toast="notice"]')!.closest<HTMLElement>('[data-slot="toast"]')!.dataset.toastColor).toBe('success');
  expect($$('[data-slot="toaster"] button.dismiss').map((el) => el.getAttribute('aria-label')))
    .toEqual(['Dismiss: Update failed', 'Dismiss: Added #61']);
});

test('more than five slots coexist in chronological order, with the newest at the bottom', async () => {
  await mountPage();
  const { showToast } = await import('./toasts.tsx');
  for (const slot of ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh']) {
    await settle(() => showToast({ slot, what: slot, body: slot }));
  }
  expect($$('[data-slot="toaster"]')).toHaveLength(1);
  expect($$('[data-slot="toaster"] [data-toast]').map((el) => el.dataset.toast))
    .toEqual(['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh']);
});

test('a new entry scrolls into view without taking keyboard focus', async () => {
  await mountPage();
  const { showToast } = await import('./toasts.tsx');
  await settle(() => showToast({ slot: 'first', what: 'First', body: 'First' }));
  const viewport = $('[data-slot="toaster"]')!;
  // jsdom has no layout; stand in for a viewport whose entries exceed its height.
  Object.defineProperty(viewport, 'scrollHeight', { value: 1_000 });
  viewport.scrollTop = 0;
  $('.add-item')!.focus();
  await settle(() => showToast({ slot: 'second', what: 'Second', body: 'Second' }));
  expect(viewport.scrollTop).toBe(1_000);
  expect(document.activeElement).toBe($('.add-item'));
});

test('the newest entry stays in view when the stack resizes, until the User scrolls away', async () => {
  const resized = new Set<() => void>();
  vi.stubGlobal('ResizeObserver', class {
    fn: () => void;
    constructor(fn: () => void) { this.fn = fn; }
    observe() { resized.add(this.fn); }
    disconnect() { resized.delete(this.fn); }
  });
  await mountPage();
  const { showToast } = await import('./toasts.tsx');
  await settle(() => showToast({ slot: 'first', what: 'First', body: 'First' }));
  const viewport = $('[data-slot="toaster"]')!;
  // jsdom has no layout; stand in for a window that shrank under a full stack.
  Object.defineProperty(viewport, 'scrollHeight', { value: 1_000 });
  Object.defineProperty(viewport, 'clientHeight', { value: 400 });
  viewport.scrollTop = 0;
  await settle(() => resized.forEach((fn) => fn()));
  expect(viewport.scrollTop).toBe(1_000);
  viewport.scrollTop = 50;
  viewport.dispatchEvent(new Event('scroll'));
  await settle(() => resized.forEach((fn) => fn()));
  expect(viewport.scrollTop, 'the User scrolled away').toBe(50);
  await settle(() => showToast({ slot: 'second', what: 'Second', body: 'Second' }));
  expect(viewport.scrollTop, 'a new entry leaves the User where they are').toBe(50);
});

test.each(['expires', 'is dismissed'])('reading an older warning keeps its scroll position when the newest toast %s', async (removal) => {
  await mountPage({ ...sample, tools: toolChecks({ gh: { result: 'missing', fix: 'brew install gh' } }) });
  const { showToast } = await import('./toasts.tsx');
  await settle(() => showToast({ slot: 'newest', what: 'Newest', body: 'Newest' }));
  const viewport = $('[data-slot="toaster"]')!;
  // jsdom has no layout; stand in for a viewport whose entries exceed its height.
  Object.defineProperty(viewport, 'scrollHeight', { value: 1_000 });
  const warningControl = $<HTMLButtonElement>('[data-warning="gh"] .dismiss')!;
  await settle(() => warningControl.focus());
  viewport.scrollTop = 50;
  await settle(() => removal === 'expires'
    ? vi.advanceTimersByTime(5_000)
    : $<HTMLButtonElement>('[data-toast="newest"] .dismiss')!.click());
  expect($('[data-toast="newest"]')).toBeNull();
  expect(viewport.scrollTop).toBe(50);
  expect(document.activeElement).toBe(warningControl);
});

test('replacement moves only its slot to the bottom, and clearing removes only the named slot', async () => {
  await mountPage();
  const { showToast, clearToast } = await import('./toasts.tsx');
  for (const slot of ['first', 'second', 'third']) {
    await settle(() => showToast({ slot, what: slot, body: slot }));
  }
  const third = $('[data-toast="third"]');
  await settle(() => showToast({ slot: 'first', what: 'Replacement', body: 'Replacement' }));
  expect($$('[data-toast]').map((el) => el.dataset.toast)).toEqual(['second', 'third', 'first']);
  expect(text($('[data-toast="first"]'))).toBe('Replacement');
  await settle(() => clearToast('second'));
  await settle(() => clearToast('missing'));
  expect($$('[data-toast]').map((el) => el.dataset.toast)).toEqual(['third', 'first']);
  expect($('[data-toast="third"]')).toBe(third);
});

test('another slot appearing or clearing does not restart a success timer or scroll away from older entries', async () => {
  await mountPage();
  const { showToast, clearToast } = await import('./toasts.tsx');
  await settle(() => showToast({ slot: 'first', what: 'First', body: 'First' }));
  await settle(() => vi.advanceTimersByTime(4_900));
  await settle(() => showToast({ slot: 'second', failed: true, what: 'Second', body: 'Second' }));
  const viewport = $('[data-slot="toaster"]')!;
  viewport.scrollTop = 50;
  await settle(() => vi.advanceTimersByTime(100));
  expect($('[data-toast="first"]')).toBeNull();
  expect($('[data-toast="second"]')).not.toBeNull();
  expect(viewport.scrollTop).toBe(50);
  await settle(() => showToast({ slot: 'third', what: 'Third', body: 'Third' }));
  await settle(() => vi.advanceTimersByTime(4_900));
  await settle(() => clearToast('second'));
  expect($('[data-toast="third"]')).not.toBeNull();
  await settle(() => vi.advanceTimersByTime(100));
  expect($('[data-toast="third"]')).toBeNull();
});

test('a failure stays until it is closed', async () => {
  await mountPage();
  const { showToast } = await import('./toasts.tsx');
  await settle(() => showToast({ slot: 'update', failed: true, what: 'Update failed', body: 'Update failed' }));
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(toast()).not.toBeNull();
  await settle(() => toast()!.querySelector<HTMLButtonElement>('[aria-label="Dismiss: Update failed"]')!.click());
  expect(toast()).toBeNull();
});

test('closing a focused toast prefers its target in the open item dialog over the same target on the board', async () => {
  await mountPage();
  // Exercise the toast's focus contract without the Modal's own focus trap redirecting focus before it closes.
  const dialog = document.createElement('dialog');
  dialog.open = true;
  dialog.setAttribute('data-item-dialog', '');
  dialog.setAttribute('data-state', 'open');
  const target = document.createElement('button');
  target.setAttribute('data-back-to-list', 'I_sample05');
  target.textContent = 'Back to List';
  dialog.append(target);
  document.body.append(dialog);
  const { showToast } = await import('./toasts.tsx');
  await settle(() => showToast({
    slot: 'notice', failed: true, what: 'Move failed', body: 'Move failed',
    focusAfter: ['[data-back-to-list="I_sample05"]'],
  }));
  const close = toast()!.querySelector<HTMLButtonElement>('button.dismiss')!;
  await settle(() => close.focus());
  await settle(() => close.click());
  expect(toast()).toBeNull();
  expect(document.activeElement).toBe(target);
});

test.each<{ screen: string; data: BoardData; selector: string }>([
  { screen: 'board', data: sample, selector: '.desk' },
  { screen: 'empty state', data: { ...sample, repos: [], items: [], repositoryConfigProblems: [], error: null }, selector: '[data-empty-state]' },
  { screen: 'T3 Code missing', data: { ...sample, tools: { ...sample.tools!, t3: { result: 'missing' } } }, selector: '.tool-missing' },
  { screen: 'loading', data: { ...sample, fetchedAt: null, firstRead: { step: 'repositories', running: [], settled: false } }, selector: '.loading-screen' },
])('the stack is available above loading on the $screen screen', async ({ data, selector }) => {
  await mountPage(data);
  addStylesheet();
  const { showToast } = await import('./toasts.tsx');
  await settle(() => showToast({ slot: 'update', failed: true, what: 'Update failed', body: 'Update failed' }));
  const viewport = $('[data-slot="toaster"]')!;
  expect($(selector)).not.toBeNull();
  expect(toast()).not.toBeNull();
  expect(viewport.closest('main, [inert]')).toBeNull();
  expect(Number(getComputedStyle(viewport).zIndex)).toBeGreaterThan(Number(getComputedStyle($('.loading-screen')!).zIndex));
  expect(getComputedStyle(toast()!).flexShrink).toBe('0');
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

test('notifications sit above every dialog, in a stack as far from the bottom edge as the right, no taller than the window under the title bar', async () => {
  await mountPage();
  addStylesheet();
  await notify({ verb: 'Moved', item: sample.items[0]!, to: 'Queued' });
  const viewport = $('[data-slot="toaster"]')!;
  expect(viewport.classList.contains('bottom-0')).toBe(true);
  expect(viewport.classList.contains('right-0')).toBe(true);
  expect(viewport.classList.contains('top-0')).toBe(false);
  const style = getComputedStyle(viewport);
  expect(style.bottom).toBe('var(--notice-edge)');
  expect(style.right).toBe('var(--notice-edge)');
  expect(style.zIndex).toBe('100');
  expect(style.width).toBe('min(calc(var(--spacing) * 104), calc(100vw - var(--spacing) * 8))');
  expect(style.maxHeight).toBe('calc(100dvh - var(--spacing) * 13 - var(--notice-edge) * 2)');
  expect(style.overflowY).toBe('auto');
  expect(style.flexDirection).toBe('column');
  expect(style.pointerEvents).toBe('auto');
  // Notices scrolled past fade at the stack's edges, as a Modal's body does, and none is cropped. The fade sits on
  // each notice, not the stack, so the stack doesn't cut the notices' backdrop blur off from the board.
  expect(style.getPropertyValue('mask-image')).toBe('none');
  expect(getComputedStyle(toast()!).getPropertyValue('mask-image')).toContain('var(--fade-top');
  expect(getComputedStyle(toast()!).flexShrink).toBe('0');
});
