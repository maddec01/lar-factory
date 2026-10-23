// The page shell: first paint, header, view tabs, live data, and what a re-render keeps.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, NOW, fetchMock, mountPage, sample, settle, stream } from './support.ts';
import type { BoardData } from '../../src/model.ts';

const fresh: BoardData = { ...sample, error: null, fetchedAt: new Date(NOW).toISOString() };
const tab = (view: string) => $<HTMLButtonElement>(`#tab-${view}`)!;
const shows = (view: string) => !$(`#panel-${view}`)!.hidden && tab(view).getAttribute('aria-selected') === 'true';
const key = (el: Element, k: string) => settle(() => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })));

test('the first paint shows the board data the server put in the page, with no fetch', async () => {
  await mountPage(fresh);
  expect($('.totals')!.textContent).toBe('4 need you8 in flight3 queued4 in List25 items');
  expect($$('.o-node').length).toBeGreaterThan(0);
  expect(fetchMock).not.toHaveBeenCalled();
  expect($('#board-data')).not.toBeNull();
});

test('the header shows the Mux logo followed by "factory", when the data was read, and the project', async () => {
  await mountPage(fresh);
  const h1 = $('h1')!;
  expect(h1.querySelector('svg.brand-mark[role="img"][aria-label="Mux"]')!.getAttribute('viewBox')).toBe('0 0 56 32');
  expect(h1.lastElementChild!.outerHTML).toBe('<span>factory</span>');
  expect($('.refreshed')!.textContent).toMatch(/^Refreshed \d\d:\d\d \(just now\) · Mux project$/);
  expect($('.totals .amber')!.textContent).toBe('4 need you');
  expect($('.banner')).toBeNull();
});

test('stale data and a failed read show a banner', async () => {
  await mountPage(sample);
  const banner = $('.banner[role="alert"]')!;
  expect(banner.textContent).toMatch(/^Stale\. Showing data from \d\d:\d\d \(20 min ago\)\. The last read through gh failed: gh api graphql failed/);
  expect(banner.querySelector('code.err')).not.toBeNull();
});

test('the tabs switch the view, and #flow names Flow', async () => {
  await mountPage();
  expect(shows('board')).toBe(true);
  expect(shows('flow')).toBe(false);
  expect(tab('board').tabIndex).toBe(0);
  expect(tab('flow').tabIndex).toBe(-1);

  await settle(() => tab('flow').click());
  expect(location.hash).toBe('#flow');
  expect(shows('flow')).toBe(true);
  expect($('#panel-board')!.hidden).toBe(true);

  await settle(() => tab('board').click());
  expect(location.hash).toBe('');
  expect(shows('board')).toBe(true);
});

test('arrow keys move to the other tab, Home and End to the first and last, and focus follows', async () => {
  await mountPage();
  tab('board').focus();
  await key(tab('board'), 'ArrowRight');
  expect(shows('flow')).toBe(true);
  expect(document.activeElement).toBe(tab('flow'));
  await key(tab('flow'), 'ArrowLeft');
  expect(shows('board')).toBe(true);
  expect(document.activeElement).toBe(tab('board'));
  await key(tab('board'), 'End');
  expect(shows('flow')).toBe(true);
  await key(tab('flow'), 'End');
  expect(shows('flow')).toBe(true);
  await key(tab('flow'), 'Home');
  expect(shows('board')).toBe(true);
  expect(document.activeElement).toBe(tab('board'));
});

test('a page opened at #flow shows Flow, and following a #flow link switches to it', async () => {
  await mountPage(sample, '#flow');
  expect(shows('flow')).toBe(true);

  await settle(() => tab('board').click());
  await settle(() => {
    location.hash = '#flow';
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  expect(shows('flow')).toBe(true);
});

test('data pushed over /api/events replaces the board, and the open stream stops the polling', async () => {
  await mountPage(fresh);
  await settle(() => stream().onopen!());
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(fetchMock).not.toHaveBeenCalled();
  expect($('.refreshed')!.textContent).toMatch(/\(1 min ago\)/);

  await settle(() => stream().onmessage!(new MessageEvent('message', { data: JSON.stringify({ ...fresh, items: fresh.items.slice(0, 1) }) })));
  expect($('.totals li:last-child')!.textContent).toBe('1 items');
});

test('while the stream is down the page fetches /api/board every 15 s, and every second during an update', async () => {
  await mountPage(fresh);
  await settle(() => vi.advanceTimersByTime(14_999));
  expect(fetchMock).not.toHaveBeenCalled();
  await settle(() => vi.advanceTimersByTime(1));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]![0]).toBe('/api/board');

  // A dropped stream hands back to polling.
  await settle(() => stream().onopen!());
  await settle(() => stream().onerror!());
  await settle(() => vi.advanceTimersByTime(15_000));
  expect(fetchMock).toHaveBeenCalledTimes(2);

  const update = { state: 'running' as const, pid: 1, finished: [], current: 'check' as const, startedAt: new Date(NOW).toISOString(), finishedAt: null, revision: null, error: null, logTail: null };
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ ...fresh, update })));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect(fetchMock).toHaveBeenCalledTimes(3);
  await settle(() => vi.advanceTimersByTime(1_000));
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

test("a failed fetch says the server can't be reached and keeps the last data", async () => {
  await mountPage(fresh);
  fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect($('.banner[role="alert"]')!.textContent).toBe("×Can't reach the board server. HTTP 502 Showing the last data this page received.");
  expect($('.totals li:last-child')!.textContent).toBe('25 items');

  fetchMock.mockImplementation(async () => new Response(JSON.stringify(fresh)));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect($('.banner')).toBeNull();
});

test("the lost server's banner closes, and the next failure after the server answers shows it again", async () => {
  await mountPage(fresh);
  fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
  await settle(() => vi.advanceTimersByTime(15_000));
  const close = $<HTMLButtonElement>('.banner .dismiss')!;
  expect(close.getAttribute('aria-label')).toBe("Dismiss: can't reach the board server");
  close.focus();
  await settle(() => close.click());
  expect($('.banner')).toBeNull();
  expect(document.activeElement, 'focus stays on the page').toBe($('.add-item'));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect($('.banner'), 'it stays closed while the server stays away').toBeNull();

  fetchMock.mockImplementation(async () => new Response(JSON.stringify(fresh)));
  await settle(() => vi.advanceTimersByTime(15_000));
  fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect($('.banner[role="alert"]')!.textContent).toContain("Can't reach the board server.");
});

const push = (data: BoardData) => settle(() => stream().onmessage!(new MessageEvent('message', { data: JSON.stringify(data) })));

test('new data keeps focus and the <details> the user opened', async () => {
  await mountPage(fresh, '#flow');
  const loose = $<HTMLDetailsElement>('#flow-loose')!;
  expect(loose.open).toBe(false);
  await settle(() => {
    loose.open = true;
    loose.dispatchEvent(new Event('toggle'));
  });
  tab('flow').focus();

  await push({ ...fresh, items: [...fresh.items].reverse() });
  expect($<HTMLDetailsElement>('#flow-loose')!.open).toBe(true);
  expect(document.activeElement).toBe(tab('flow'));
});

test('new data keeps the item at the top of the window where it was', async () => {
  await mountPage(fresh, '#flow');
  // A layout of 40px rows, scrolled 400px down, so row 10 tops the window; a banner above adds 120px.
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(() => [{}] as unknown as DOMRectList);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const top = $$('[data-anchor]').indexOf(this as HTMLElement) * 40 - 400 + ($('.banner') ? 120 : 0);
    return { top, bottom: top + 40 } as DOMRect;
  });
  vi.stubGlobal('scrollY', 400);

  await push({ ...fresh, error: 'gh failed' });
  expect($('.banner')).not.toBeNull();
  expect(window.scrollBy).toHaveBeenCalledExactlyOnceWith(0, 120);
});
