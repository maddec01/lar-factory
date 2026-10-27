// The item dialog's "Load 10 more": it shows when older comments exist, appends the next page in the details' order,
// hides at the end, keeps the comments already shown when a load fails and lets the button retry, and starts over
// at the latest comments when the dialog reopens.

import { expect, test } from 'vite-plus/test';
import sampleDetailsJson from '@lar-factory/shared/test/sample-details.json' with { type: 'json' };
import { $, $$, fetchMock, mountPage, settle, text } from '../../test/support.ts';
import type { ItemComment } from '@lar-factory/shared';

/** The sample's older comments of Owner accounts, newest first: 14, so a page of 10 and a page of 4. */
const OLDER = (sampleDetailsJson as unknown as { $older: Record<string, ItemComment[]> }).$older['I_sample13']!;

const dialog = () => $('[data-item-dialog]')!;
const authors = () => $$('[data-comments] li').map((li) => text(li.querySelector('.font-medium')));
const bodies = () => $$('[data-comments] li [data-slot="rich-text"]').map(text);
const loadMore = () => [...dialog().querySelectorAll<HTMLButtonElement>('[data-comments] button')].find((b) => /Load 10 more/.test(text(b)));
const errorText = () => text(dialog().querySelector('[data-comments] [role="alert"]'));
/** The older-comment reads the page made, as the parameters each carried. */
const pageReads = () => (fetchMock.mock.calls as unknown as [string][]).map(([url]) => url).filter((url) => url.startsWith('/api/item-comments'))
  .map((url) => Object.fromEntries(new URL(url, 'http://board').searchParams));

async function openItem(itemId: string): Promise<void> {
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(itemId));
}
async function closeItem(): Promise<void> {
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().close());
}

/** The board answering older-comment reads from `OLDER` 10 at a time by cursor; `fail` makes the next reads fail. */
function serveOlder(): { fail: (count: number) => void; hold: () => (() => Promise<void>) } {
  let failing = 0;
  let holding: Promise<void> | null = null;
  let release = () => {};
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (url: string) => {
    if (!url.startsWith('/api/item-comments')) return original(url);
    await holding;
    if (failing > 0) { failing--; return new Response(JSON.stringify({ error: 'GitHub is rate limiting the board.' }), { status: 502 }); }
    const from = Number(new URL(url, 'http://board').searchParams.get('before'));
    return new Response(JSON.stringify({ page: { comments: OLDER.slice(from, from + 10), olderCursor: from + 10 < OLDER.length ? String(from + 10) : null } }));
  });
  return {
    fail: (count) => { failing = count; },
    hold: () => {
      holding = new Promise((resolve) => { release = resolve; });
      return () => settle(release);
    },
  };
}

test('an item with older comments shows Load 10 more under its comments, and an item without shows none', async () => {
  await mountPage();
  await openItem('I_sample13');
  expect(text(loadMore())).toBe('Load 10 more');
  expect(authors()).toEqual(['maddec01', 'claude-bot', 'reviewer-anne']);
  await closeItem();
  await openItem('I_sample26');
  expect(loadMore()).toBeUndefined();
});

test('Load 10 more reads the page before the details\' cursor and appends it in order, then the last page hides the button', async () => {
  const server = serveOlder();
  await mountPage();
  await openItem('I_sample13');
  const release = server.hold();
  await settle(() => loadMore()!.click());
  expect(pageReads()).toEqual([{ itemId: 'I_sample13', before: '0' }]);
  expect(loadMore()!.disabled, 'disabled while it loads').toBe(true);
  expect(loadMore()!.querySelector('svg.animate-spin'), 'with a spinner').not.toBeNull();
  await release();
  expect(bodies().slice(3)).toEqual(OLDER.slice(0, 10).map((c) => c.body));
  expect(authors()).toHaveLength(13);
  expect(bodies().slice(0, 3)[0]).toContain('Moving this to');
  expect(text($('[data-comments] h2'))).toBe('Comments · 13');
  expect(loadMore()!.disabled).toBe(false);

  await settle(() => loadMore()!.click());
  expect(pageReads().at(-1)).toEqual({ itemId: 'I_sample13', before: '10' });
  expect(bodies().slice(13)).toEqual(OLDER.slice(10).map((c) => c.body));
  expect(authors()).toHaveLength(17);
  expect(loadMore(), 'no older comments are left').toBeUndefined();
});

test('a failed load shows its error next to the button, keeps the comments shown and lets the button retry', async () => {
  const server = serveOlder();
  await mountPage();
  await openItem('I_sample13');
  server.fail(1);
  await settle(() => loadMore()!.click());
  expect(errorText()).toBe('Could not load older comments: GitHub is rate limiting the board.');
  expect(authors()).toHaveLength(3);
  expect(loadMore()!.disabled).toBe(false);

  await settle(() => loadMore()!.click());
  expect(pageReads().map((r) => r.before)).toEqual(['0', '0']);
  expect(authors()).toHaveLength(13);
  expect(errorText(), 'the error clears once a load works').toBe('');
});

test('a read that cannot reach the board fails the same way', async () => {
  const original = fetchMock.getMockImplementation()!;
  await mountPage();
  await openItem('I_sample13');
  fetchMock.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/item-comments')) throw new TypeError('Failed to fetch');
    return original(url);
  });
  await settle(() => loadMore()!.click());
  expect(errorText()).toBe('Could not load older comments: Could not reach the board to read them.');
  expect(authors()).toHaveLength(3);
});

test('reopening the dialog starts again at the latest comments', async () => {
  serveOlder();
  await mountPage();
  await openItem('I_sample13');
  await settle(() => loadMore()!.click());
  expect(authors()).toHaveLength(13);
  await closeItem();
  await openItem('I_sample13');
  expect(authors()).toHaveLength(3);
  await settle(() => loadMore()!.click());
  expect(pageReads().map((r) => r.before), 'the first older page again, not the second').toEqual(['0', '0']);
  expect(authors()).toHaveLength(13);
});

test('a page that lands after the dialog closed and reopened is not added to the new comments', async () => {
  const server = serveOlder();
  await mountPage();
  await openItem('I_sample13');
  const release = server.hold();
  await settle(() => loadMore()!.click());
  await closeItem();
  await openItem('I_sample13');
  await release();
  expect(authors()).toHaveLength(3);
});
