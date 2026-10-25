// The page shell: first paint, the control room, live data, and what a re-render keeps.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, NOW, bannerText, fetchMock, mountPage, push, sample, settle, stream } from '../test/support.ts';
import { BRAND_MARK_PATH } from '@mux-factory/shared';
import type { BoardData } from '@mux-factory/shared';

const fresh: BoardData = { ...sample, error: null, fetchedAt: new Date(NOW).toISOString() };

test('the first paint shows the board data the server put in the page, with no fetch', async () => {
  await mountPage(fresh);
  expect($$('.desk-card')).toHaveLength(4);
  expect($$('.sidebar button[data-item]')).toHaveLength(4);
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

test('fresh data shows no banner', async () => {
  await mountPage(fresh);
  expect($('.banner')).toBeNull();
});

test('stale data and a failed read show no banner, the title bar carries them', async () => {
  await mountPage(sample);
  expect($('.banner')).toBeNull();
});

test('the page is the control room, with no tabs: the sidebar, then the title bar, banners, desk and line', async () => {
  await mountPage();
  expect($('.sidebar')!.compareDocumentPosition($('main')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect([...$('main')!.querySelectorAll('.title-bar, .banners, .desk, .line')].map((el) => el.classList[0])).toEqual(['title-bar', 'banners', 'desk', 'line']);
  expect($$('[role="tablist"], [role="tab"], [role="tabpanel"]')).toEqual([]);
});

test('a page opened at #flow shows the control room and keeps the hash', async () => {
  await mountPage(sample, '#flow');
  expect($$('.desk-card')).toHaveLength(4);
  expect(location.hash).toBe('#flow');
});

test('data pushed over /api/events replaces the board, and the open stream stops the polling', async () => {
  await mountPage(fresh);
  await settle(() => stream().onopen!());
  await settle(() => vi.advanceTimersByTime(60_000));
  expect(fetchMock).not.toHaveBeenCalled();
  expect($('.refreshed')!.textContent).toBe('refreshed 1m ago');

  await settle(() => stream().onmessage!(new MessageEvent('message', { data: JSON.stringify({ ...fresh, items: fresh.items.slice(0, 1) }) })));
  expect($$('.sidebar button[data-item]')).toHaveLength(1);
  expect($$('.desk-card')).toHaveLength(0);
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
  expect($$('.desk-card')).toHaveLength(4);

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

test('new data keeps focus and the groups the user collapsed', async () => {
  await mountPage(fresh);
  const chevron = () => $<HTMLButtonElement>('.list-group[data-platform="Server"] button[aria-expanded]')!;
  await settle(() => chevron().click());
  $('.add-item')!.focus();

  await push({ ...fresh, items: [...fresh.items].reverse() });
  expect(chevron().getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe($('.add-item'));
});
