// The page shell: first paint, header, the Board view, live data, and what a re-render keeps.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, NOW, bannerText, fetchMock, mountPage, push, sample, settle, stream } from '../test/support.ts';
import { BRAND_MARK_PATH } from '@mux-factory/shared';
import type { BoardData } from '@mux-factory/shared';

const fresh: BoardData = { ...sample, error: null, fetchedAt: new Date(NOW).toISOString() };

test('the first paint shows the board data the server put in the page, with no fetch', async () => {
  await mountPage(fresh);
  expect($('.totals')!.textContent).toBe('4 need you7 in flight3 queued4 in List25 items');
  expect($$('#panel-board article').length).toBeGreaterThan(0);
  expect(fetchMock).not.toHaveBeenCalled();
  expect($('#board-data')).not.toBeNull();
});

test('the tab shows "µx Factory" and the logo as its icon', async () => {
  await mountPage(fresh);
  expect(document.title).toBe('µx Factory');
  const icon = decodeURIComponent($<HTMLLinkElement>('link[rel="icon"]')!.getAttribute('href')!);
  expect(icon).toMatch(/^data:image\/svg\+xml,<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 56 32"/);
  expect(icon).toContain(`d="${BRAND_MARK_PATH}"`);
});

test('an entered title round-trips through the inline board data without closing its script element', async () => {
  const title = 'Play <queue> & "mix" </script> $& $1';
  await mountPage({ ...fresh, items: [{ ...fresh.items[0]!, title }] });
  const script = $('#board-data')!;
  expect(script.innerHTML).not.toContain('</script>');
  expect((JSON.parse(script.textContent!) as BoardData).items[0]!.title).toBe(title);
  expect(document.body.textContent).toContain(title);
});

test('the header shows the Mux logo followed by "factory", and how long ago the data was read', async () => {
  await mountPage(fresh);
  const h1 = $('h1')!;
  expect(h1.querySelector('svg.brand-mark[role="img"][aria-label="Mux"]')!.getAttribute('viewBox')).toBe('0 0 56 32');
  expect(h1.lastElementChild!.outerHTML).toBe('<span>factory</span>');
  expect($('.refreshed')!.textContent).toBe('Refreshed 0s ago');
  expect($('.refreshed a')).toBeNull();
  expect($('.totals .amber')!.textContent).toBe('4 need you');
  expect($$('.totals li').map((li) => [li.dataset.slot, li.className.includes('bg-warning/8')]), 'counts are badges, need you in amber')
    .toEqual([['badge', true], ['badge', false], ['badge', false], ['badge', false], ['badge', false]]);
  expect($('.banner')).toBeNull();
});

test('Refreshed counts up each second, between the board\'s 15 s ticks', async () => {
  await mountPage(fresh);
  await settle(() => vi.advanceTimersByTime(12_000));
  expect($('.refreshed')!.textContent).toBe('Refreshed 12s ago');
  await settle(() => vi.advanceTimersByTime(1_000));
  expect($('.refreshed')!.textContent).toBe('Refreshed 13s ago');
});

test('Refreshed reads "Not read yet" before the first read', async () => {
  await mountPage({ ...fresh, fetchedAt: null });
  expect($('.refreshed')!.textContent).toBe('Not read yet');
});

test('stale data and a failed read show a banner', async () => {
  await mountPage(sample);
  const banner = $('.banner[role="alert"][data-variant="warning"]')!;
  expect(bannerText(banner)[0]).toBe('Stale.');
  expect(bannerText(banner)[1]).toMatch(/^Showing data from \d\d:\d\d \(20 min ago\)\. The last read through gh failed: gh api graphql failed/);
  expect(banner.querySelector('code.err')).not.toBeNull();
});

test('the page shows the Board view with no tabs', async () => {
  await mountPage();
  const panel = $('#panel-board')!;
  expect(panel.hidden).toBe(false);
  expect(panel.getAttribute('role')).toBeNull();
  expect($('#needs-you')!.closest('#panel-board')).toBe(panel);
  expect($$('[role="tablist"], [role="tab"], [role="tabpanel"]')).toEqual([]);
});

test('a page opened at #flow shows the Board view and keeps the hash', async () => {
  await mountPage(sample, '#flow');
  expect($('#panel-board')!.hidden).toBe(false);
  expect($$('#panel-board article').length).toBeGreaterThan(0);
  expect(location.hash).toBe('#flow');
});

test('data pushed over /api/events replaces the board, and the open stream stops the polling', async () => {
  await mountPage(fresh);
  await settle(() => stream().onopen!());
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(fetchMock).not.toHaveBeenCalled();
  expect($('.refreshed')!.textContent).toBe('Refreshed 1m ago');

  await settle(() => stream().onmessage!(new MessageEvent('message', { data: JSON.stringify({ ...fresh, items: fresh.items.slice(0, 1) }) })));
  expect($('.totals li:last-child')!.textContent).toBe('1 items');
});

test('while the stream is down the page fetches /api/board every 15 s', async () => {
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
});

test("a failed fetch says the server can't be reached and keeps the last data", async () => {
  await mountPage(fresh);
  fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect(bannerText($('.banner[role="alert"]')!)).toEqual(["Can't reach the board server.", 'HTTP 502 Showing the last data this page received.']);
  expect($('.totals li:last-child')!.textContent).toBe('25 items');

  fetchMock.mockImplementation(async () => new Response(JSON.stringify(fresh)));
  await settle(() => vi.advanceTimersByTime(15_000));
  expect($('.banner')).toBeNull();
});

test("the lost server's banner closes, and the next failure after the server answers shows it again", async () => {
  await mountPage(fresh);
  fetchMock.mockImplementation(async () => new Response('', { status: 502 }));
  await settle(() => vi.advanceTimersByTime(15_000));
  const close = $<HTMLButtonElement>('.banner [data-slot="alert-action"] .dismiss')!;
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
  expect(bannerText($('.banner[role="alert"]')!)[0]).toBe("Can't reach the board server.");
});

test('new data keeps focus and the disclosures the user opened', async () => {
  await mountPage(fresh);
  const isOpen = () => $('#done-list')!.hasAttribute('data-open');
  expect(isOpen()).toBe(false);
  await settle(() => $<HTMLButtonElement>('#done-list > [data-slot="collapsible-trigger"]')!.click());
  $('.add-item')!.focus();

  await push({ ...fresh, items: [...fresh.items].reverse() });
  expect(isOpen()).toBe(true);
  expect(document.activeElement).toBe($('.add-item'));
});

test('new data keeps the item at the top of the window where it was', async () => {
  await mountPage(fresh);
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
