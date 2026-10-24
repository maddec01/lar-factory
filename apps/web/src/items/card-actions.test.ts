// Queue, Back to List and Abandon: each posts to its endpoint, shows its pending state, then the
// result as a toast or an error, and keeps focus on the page when the item leaves.
// Ported from the card action cases of test/render.test.ts.

import { afterEach, expect, test, vi } from 'vite-plus/test';
import { $, $$, fetchMock, mountPage, sample, settle } from './support.ts';
import type { BoardData, Status } from '@mux-factory/shared';

const text = (el: Element | null | undefined) => el?.textContent ?? '';
const button = (attr: string, id: string) => $<HTMLButtonElement>(`[data-${attr}="${id}"]`)!;
const toast = () => $('.toasts .toast');
const moved = (id: string, status: Status): BoardData => ({ ...sample, items: sample.items.map((i) => (i.id === id ? { ...i, status } : i)) });
const without = (id: string): BoardData => ({ ...sample, items: sample.items.filter((i) => i.id !== id) });

/** Each POST waits until the test answers it, so the pending state can be seen. */
let answer: (body: object, status?: number) => Promise<void>;
function holdPosts(): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/board') return new Response(JSON.stringify(sample));
    return new Promise<Response>((resolve) => {
      answer = (body, status = 200) => settle(() => resolve(new Response(JSON.stringify(body), { status })));
    });
  });
}
const posted = () => fetchMock.mock.calls.map((call) => {
  const [url, init] = call as unknown as [string, RequestInit | undefined];
  return [url, init?.body && JSON.parse(init.body as string)];
});

afterEach(() => {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(sample)));
});

test('Queue shows the action in flight, then moves the row to Queued, says so, and keeps focus in the list', async () => {
  holdPosts();
  await mountPage();
  button('queue', 'PVTI_sample01').focus();
  await settle(() => button('queue', 'PVTI_sample01').click());
  const queuing = button('queue', 'PVTI_sample01');
  expect([text(queuing), queuing.getAttribute('aria-disabled'), queuing.getAttribute('aria-label')]).toEqual(['Queuing…', 'true', `Queuing… #61 ${sample.items[0]!.title}`]);
  expect(button('abandon', 'PVTI_sample01').getAttribute('aria-disabled'), 'the row is held').toBe('true');
  expect(text(button('abandon', 'PVTI_sample01')), 'Abandon is not relabelled').toBe('Abandon');
  expect(posted()).toEqual([['/api/queue', { itemId: 'PVTI_sample01' }]]);

  await answer({ error: null, board: moved('PVTI_sample01', 'Queued') });
  expect($('#list [data-anchor="PVTI_sample01"]')).toBeNull();
  expect($('#queued article[data-anchor="PVTI_sample01"]')).not.toBeNull();
  expect([toast()!.getAttribute('role'), text(toast())]).toEqual(['status', `×Moved #61 ${sample.items[0]!.title} to Queued. View item`]);
  expect(toast()!.querySelector('button.dismiss')!.getAttribute('aria-label')).toBe('Dismiss: Moved #61');
  expect(document.activeElement, 'the next row’s Queue').toBe(button('queue', 'PVTI_sample02'));
});

test('a failed Queue stays on its row with a close button, which hands focus back to Queue', async () => {
  holdPosts();
  await mountPage();
  await settle(() => button('queue', 'PVTI_sample02').click());
  await answer({ error: 'Could not set Queued.' }, 502);
  const error = $('[data-anchor="PVTI_sample02"] .action-error')!;
  expect(text(error.querySelector('[role="alert"]'))).toBe('Could not set Queued.');
  expect(text(button('queue', 'PVTI_sample02')), 'Queue is back').toBe('Queue');
  expect(toast(), 'no toast').toBeNull();
  const close = error.querySelector<HTMLButtonElement>('button.dismiss')!;
  expect(close.getAttribute('aria-label')).toBe('Dismiss error for #114');
  close.focus();
  await settle(() => close.click());
  expect($('.action-error')).toBeNull();
  expect(document.activeElement).toBe(button('queue', 'PVTI_sample02'));
});

test("a server that can't be reached is a Queue error too", async () => {
  fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
  await mountPage();
  await settle(() => button('queue', 'PVTI_sample01').click());
  expect(text($('[data-anchor="PVTI_sample01"] .action-error [role="alert"]'))).toBe("Can't reach the board server. Try again.");
});

test('Back to List shows only its own pending state, then moves the card and keeps focus in Queued', async () => {
  holdPosts();
  await mountPage();
  const back = button('back-to-list', 'PVTI_sample05');
  back.focus();
  await settle(() => back.click());
  expect([text(back), back.getAttribute('aria-label')!.split(' ').slice(0, 2).join(' '), back.getAttribute('aria-disabled')]).toEqual(['← Moving to List…', 'Moving #129', 'true']);
  expect(text(button('abandon', 'PVTI_sample05')), 'Abandon is not relabelled').toBe('Abandon');
  expect(text(button('start', 'PVTI_sample05')), 'Start is not relabelled').toBe('Start ▾');
  expect(posted()).toEqual([['/api/back-to-list', { itemId: 'PVTI_sample05' }]]);

  await answer({ error: null, board: moved('PVTI_sample05', 'List') });
  expect($('#queued [data-anchor="PVTI_sample05"]')).toBeNull();
  expect(text(toast())).toMatch(/^×Moved #129 .* to List\. View item$/);
  const next = $$('#queued article')[0]!.querySelector('[data-start],[data-back-to-list],[data-abandon]');
  expect(document.activeElement, "the next card's first action").toBe(next);
});

test('the last Queued card leaving hands focus to the Queued heading', async () => {
  holdPosts();
  const data: BoardData = { ...sample, items: sample.items.filter((i) => i.status !== 'Queued' || i.id === 'PVTI_sample05') };
  await mountPage(data);
  button('back-to-list', 'PVTI_sample05').focus();
  await settle(() => button('back-to-list', 'PVTI_sample05').click());
  await answer({ error: null, board: { ...data, items: data.items.map((i) => (i.id === 'PVTI_sample05' ? { ...i, status: 'List' as const } : i)) } });
  expect(document.activeElement).toBe($('#queued-h'));
});

test('a failed card action shows as a toast naming the item, which stays until closed and hands focus back', async () => {
  holdPosts();
  await mountPage();
  button('back-to-list', 'PVTI_sample05').focus();
  await settle(() => button('back-to-list', 'PVTI_sample05').click());
  await answer({ error: 'Could not set List. GitHub is down.' }, 502);
  expect(toast()!.getAttribute('role')).toBe('alert');
  expect(toast()!.dataset.tone, 'the board\'s own failure toasts keep their look').toBeUndefined();
  expect(text(toast())).toMatch(/^×Couldn't move #129 .* to List\. Could not set List\. GitHub is down\.$/);
  expect(toast()!.querySelector('a.title'), 'it links the item').not.toBeNull();
  expect($('[data-anchor="PVTI_sample05"] .action-error'), 'the card shows no inline error').toBeNull();
  expect(text(button('back-to-list', 'PVTI_sample05')), 'the footer goes back to its links').toBe('← Back to List');
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(toast(), 'a failure stays').not.toBeNull();
  const close = toast()!.querySelector<HTMLButtonElement>('button.dismiss')!;
  expect(close.getAttribute('aria-label')).toBe('Dismiss: error for #129');
  close.focus();
  await settle(() => close.click());
  expect(toast()).toBeNull();
  expect(document.activeElement, 'back to the button that failed').toBe(button('back-to-list', 'PVTI_sample05'));
});

test('Abandon asks first, naming the issue it deletes or the draft it removes; Cancel returns focus', async () => {
  await mountPage();
  const abandon = button('abandon', 'PVTI_sample01');
  abandon.focus();
  await settle(() => abandon.click());
  const dialog = $('#abandon-dialog')!;
  expect(dialog.getAttribute('role')).toBe('alertdialog');
  expect(text($('#abandon-heading'))).toBe(`Delete #61 ${sample.items[0]!.title}?`);
  expect(text($('#abandon-detail'))).toBe("This permanently deletes the issue from maddec01/mux-server on GitHub. It can't be undone.");
  expect($$('#abandon-dialog button').map(text)).toEqual(['Cancel', 'Delete issue']);
  await settle(() => vi.advanceTimersByTime(100));
  expect(document.activeElement, 'Cancel takes focus').toBe($$('#abandon-dialog button')[0]);
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog button')[0]!.click());
  await settle(() => vi.advanceTimersByTime(100));
  expect($('#abandon-dialog')).toBeNull();
  expect(document.activeElement).toBe(button('abandon', 'PVTI_sample01'));
  expect(fetchMock, 'nothing posted').not.toHaveBeenCalled();

  await settle(() => button('abandon', 'PVTI_sample04').click());
  expect(text($('#abandon-heading'))).toMatch(/^Remove draft Shared playback history across devices\?$/);
  expect($$('#abandon-dialog button').map(text)).toEqual(['Cancel', 'Remove draft']);
  await settle(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect($('#abandon-dialog'), 'Escape cancels').toBeNull();
});

test('confirming Abandon deletes the item, shows it in flight, and announces it without a link', async () => {
  holdPosts();
  const data: BoardData = { ...sample, capture: { enabled: true, session: 'session-1' } as BoardData['capture'] };
  await mountPage(data);
  button('abandon', 'PVTI_sample01').focus();
  await settle(() => button('abandon', 'PVTI_sample01').click());
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog button')[1]!.click());
  expect(posted()).toEqual([['/api/abandon', { session: 'session-1', itemId: 'PVTI_sample01' }]]);
  const abandoning = button('abandon', 'PVTI_sample01');
  expect([text(abandoning), abandoning.getAttribute('aria-disabled')]).toEqual(['Abandoning…', 'true']);
  expect(button('queue', 'PVTI_sample01').getAttribute('aria-disabled')).toBe('true');
  expect(text(button('queue', 'PVTI_sample01')), 'Queue is not relabelled').toBe('Queue');

  await answer({ error: null, board: without('PVTI_sample01') });
  expect($('[data-anchor="PVTI_sample01"]')).toBeNull();
  expect(text(toast())).toBe(`×Deleted #61 ${sample.items[0]!.title}.`);
  expect(toast()!.querySelector('a, .view-item'), 'nothing to link to').toBeNull();
  expect(document.activeElement, "the next row's Abandon").toBe(button('abandon', 'PVTI_sample02'));
});

test("a failed Abandon stays on a List row, but is a toast for a Queued card", async () => {
  holdPosts();
  await mountPage();
  await settle(() => button('abandon', 'PVTI_sample02').click());
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog button')[1]!.click());
  await answer({ error: 'Could not delete #114. Must have admin rights.' }, 502);
  expect(text($('[data-anchor="PVTI_sample02"] .action-error [role="alert"]'))).toBe('Could not delete #114. Must have admin rights.');
  expect(toast()).toBeNull();

  button('abandon', 'PVTI_sample05').focus();
  await settle(() => button('abandon', 'PVTI_sample05').click());
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog button')[1]!.click());
  await answer({ error: 'Could not delete #129.' }, 502);
  expect(text(toast())).toMatch(/^×Couldn't abandon #129 .*\. Could not delete #129\.$/);
  expect(document.activeElement, 'back to its Abandon').toBe(button('abandon', 'PVTI_sample05'));
});

test('in sample mode the buttons are disabled', async () => {
  await mountPage({ ...sample, capture: { enabled: false } as BoardData['capture'] });
  for (const b of [button('queue', 'PVTI_sample01'), button('back-to-list', 'PVTI_sample05'), button('abandon', 'PVTI_sample01')]) {
    expect([b.disabled, b.title]).toEqual([true, 'Disabled in sample mode']);
  }
});
