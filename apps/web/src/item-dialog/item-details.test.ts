// The item dialog's details: the description and comments in its main column, the people, dates, milestone or iteration
// and area in the meta area under its title, and the sub-tickets in its sidebar, with the loading, failed and empty states, one read per open, and a reply for an item no longer open
// ignored.

import { expect, test } from 'vite-plus/test';
import { $, $$, detailsReply, detailsRead, fetchMock, mountPage, push, sample, settle, text } from '../../test/support.ts';
import type { BoardData, Item } from '@lar-factory/shared';

const dialog = () => $('[data-item-dialog]');
const inDialog = <T extends Element = HTMLElement>(selector: string) => dialog()!.querySelector<T>(selector);
const description = () => inDialog('[data-description]');
const comments = () => inDialog('[data-comments]');
const meta = () => text(inDialog('[data-meta]'));
const sidebar = () => text(inDialog('aside'));
/** The details reads still wanted: StrictMode starts each effect twice in the page and aborts the first read. */
const reads = () => (fetchMock.mock.calls as unknown as [string, RequestInit][]).filter(([, init]) => !init.signal?.aborted).map(([url]) => detailsRead(url)).filter(Boolean);

async function openItem(itemId: string): Promise<void> {
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(itemId));
}
async function closeItem(): Promise<void> {
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().close());
}

/** Holds each details read until the test answers it, keyed by item id; a read of the board still gets the sample. */
function holdReads(): Map<string, (response: Response) => void> {
  const held = new Map<string, (response: Response) => void>();
  fetchMock.mockImplementation(async (url: string) => {
    const itemId = detailsRead(url);
    if (!itemId) return new Response(JSON.stringify(sample));
    return new Promise<Response>((resolve) => held.set(itemId, resolve));
  });
  return held;
}
const reply = (held: Map<string, (response: Response) => void>, itemId: string, response: Response = detailsReply(itemId)) =>
  settle(() => held.get(itemId)!(response));

/** An item of the sample, re-pointed at an Azure DevOps repository as a work item is. */
const azureItem = (): [BoardData, string] => {
  const id = 'azure:contoso/310';
  const item: Item = { ...sample.items[0]!, id, number: 310, repo: 'contoso/Fabrikam/web', url: 'https://dev.azure.com/contoso/Fabrikam/_workitems/edit/310', labels: ['bug'] };
  return [{ ...sample, repos: [...sample.repos, { repo: item.repo!, role: 'Web client', items: 'sprint', team: 'Web', show: 'all', labels: [] }], items: [item, ...sample.items.slice(1)] }, id];
};

test('while the details load the dialog shows the board data and a loading state, then the issue as GitHub shows it', async () => {
  const held = holdReads();
  await mountPage();
  await openItem('I_sample13');
  expect(text(inDialog('[data-slot="dialog-title"]'))).toBe('#140 Owner accounts');
  expect(inDialog('[data-labels]')!.textContent).toBe('build');
  expect(inDialog('[aria-busy="true"]'), 'the loading state').not.toBeNull();
  expect(description()).toBeNull();

  await reply(held, 'I_sample13');
  expect(inDialog('[aria-busy="true"]')).toBeNull();
  const body = description()!;
  expect(text(body.querySelector('h2'))).toBe('Description');
  expect([...body.querySelectorAll('table th')].map(text)).toEqual(['Column', 'Type', 'Notes']);
  expect(body.querySelectorAll('input[type="checkbox"]')).toHaveLength(3);
  expect(text(body.querySelector('pre code'))).toContain('createOwner');
  expect(text(body.querySelector('details summary'))).toBe('Open questions');
  expect(body.querySelector('img'), 'an image is a link').toBeNull();
  expect(body.querySelector<HTMLAnchorElement>('a[href="https://example.com/sign-up-flow.png"]')).not.toBeNull();

  expect($$('[data-comments] li').map((li) => text(li.querySelector('.font-medium')))).toEqual(['maddec01', 'claude-bot', 'reviewer-anne']);
  expect(text(comments()!.querySelector('h2'))).toBe('Comments · 3');
  expect(meta()).toMatch(/Author.maddec01/);
  expect(meta()).toMatch(/Assignees.maddec01.claude-bot/);
  expect(meta()).toMatch(/MilestoneCloud v0\.1/);
  expect(meta()).toMatch(/Created9d ago/);
  expect(meta()).not.toMatch(/Iteration|Area/);
  expect(sidebar()).toMatch(/Sub-tickets.*#144 Owner table and sign-up.*#145 Sign-in sessions.*#146 Owner settings page/);
  expect($$('[data-item-dialog] aside li a').map((a) => a.getAttribute('href'))).toContain('https://github.com/maddec01/lar-server/issues/145');
});

test('a pull request item shows its description, comments and people with its checks in the meta area', async () => {
  await mountPage();
  await openItem('I_sample26');
  expect(meta()).toMatch(/checks running.*4\/6 passed/);
  expect(text(description())).toContain('Bumps FFmpeg from 7.0 to 7.1.');
  expect($$('[data-comments] li')).toHaveLength(1);
  expect(meta()).toMatch(/Author.claude-bot/);
  expect(meta()).toMatch(/Assignees.maddec01/);
});

test('a draft shows its body', async () => {
  await mountPage();
  await openItem('I_sample04');
  expect(text(description())).toContain('Keep one watch history per household');
  expect(text(comments())).toBe('CommentsNo comments.');
});

test('an Azure DevOps work item shows its iteration and area in place of a milestone, and each comment in its own format', async () => {
  const [data, id] = azureItem();
  await mountPage(data);
  await openItem(id);
  expect(meta()).toMatch(/IterationFabrikam\\Sprint 42/);
  expect(meta()).toMatch(/AreaFabrikam\\Web/);
  expect(meta()).not.toMatch(/Milestone/);
  expect(description()!.querySelector('b')!.textContent).toBe('sign-in');
  expect(description()!.querySelector('img'), 'an image is a link').toBeNull();
  const [markdown, html] = $$('[data-comments] li').map((li) => li.querySelector('[data-slot="rich-text"]')!);
  expect([text(markdown), text(html)]).toEqual(['I can reproduce it with a locked test account.', 'Seen on iOS too.']);
  expect(html!.querySelector('b')).not.toBeNull();
});

test('an item with no description and no comments shows an empty state for each, not an error', async () => {
  await mountPage();
  await openItem('I_sample01');
  expect(text(description())).toBe('DescriptionNo description.');
  expect(text(comments())).toBe('CommentsNo comments.');
  expect(inDialog('[role="alert"]')).toBeNull();
});

test('a failed read shows its error in the modal and the board data stays visible', async () => {
  const held = holdReads();
  await mountPage();
  await openItem('I_sample13');
  await reply(held, 'I_sample13', new Response(JSON.stringify({ error: 'Item details are not available yet.' }), { status: 501 }));
  expect(text(inDialog('[role="alert"]'))).toBe('Could not load the details: Item details are not available yet.');
  expect(text(inDialog('[data-slot="dialog-title"]'))).toBe('#140 Owner accounts');
  expect(inDialog('[data-labels]')!.textContent).toBe('build');
  expect(text(inDialog('[data-slices] p'))).toBe('Slices · 1/3 done');
  expect(inDialog('[aria-busy="true"]')).toBeNull();
});

test('a read that cannot reach the board fails the same way', async () => {
  fetchMock.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
  await mountPage();
  await openItem('I_sample13');
  expect(text(inDialog('[role="alert"]'))).toBe('Could not load the details: Could not reach the board to read the details.');
});

test('one read per open: live board data updates the board fields and leaves the fetched details as fetched', async () => {
  await mountPage();
  await openItem('I_sample13');
  expect(reads()).toEqual(['I_sample13']);
  const before = text(description());
  await push({ ...sample, items: sample.items.map((i) => (i.id === 'I_sample13' ? { ...i, labels: ['build', 'urgent'], updatedAt: '2026-10-21T09:30:00Z' } : i)) });
  expect(inDialog('[data-labels]')!.textContent).toBe('buildurgent');
  expect(text(description())).toBe(before);
  expect(reads()).toEqual(['I_sample13']);
});

/** The sample with Owner accounts updated at `updatedAt`, as the board pushes it after a comment. */
const updatedAt = (iso: string): BoardData => ({ ...sample, items: sample.items.map((i) => (i.id === 'I_sample13' ? { ...i, updatedAt: iso } : i)) });

test('reopening the dialog on an item whose updatedAt is unchanged shows its details at once, with no read', async () => {
  const held = holdReads();
  await mountPage();
  await openItem('I_sample13');
  await reply(held, 'I_sample13');
  const before = text(description());
  const earlier = fetchMock.mock.calls.length;
  await closeItem();
  await openItem('I_sample13');
  expect(fetchMock.mock.calls.length, 'no read of its own').toBe(earlier);
  expect(inDialog('[aria-busy="true"]'), 'no loading state').toBeNull();
  expect(text(description())).toBe(before);
});

test('reopening the dialog once the item\'s updatedAt has changed reads the details again', async () => {
  const held = holdReads();
  await mountPage();
  await openItem('I_sample13');
  await reply(held, 'I_sample13');
  expect(description()).not.toBeNull();
  const earlier = fetchMock.mock.calls.length;
  await closeItem();
  await push(updatedAt('2026-10-21T09:45:00Z'));
  await openItem('I_sample13');
  expect(fetchMock.mock.calls.length, 'a read of its own').toBeGreaterThan(earlier);
  expect(reads(), 'the earlier read ended with the dialog').toEqual(['I_sample13']);
  expect(inDialog('[aria-busy="true"]'), 'loading again, not the earlier details').not.toBeNull();
  expect(description()).toBeNull();
  await reply(held, 'I_sample13');
  expect(description()).not.toBeNull();
});

test('a comment that moves updatedAt while the dialog is open does not read again until it reopens', async () => {
  const held = holdReads();
  await mountPage();
  await openItem('I_sample13');
  await reply(held, 'I_sample13');
  await push(updatedAt('2026-10-21T09:45:00Z'));
  await closeItem();
  await openItem('I_sample13');
  expect(inDialog('[aria-busy="true"]'), 'the details were read at the earlier updatedAt').not.toBeNull();
});

test('a reply for an item that is no longer open is ignored', async () => {
  const held = holdReads();
  await mountPage();
  await openItem('I_sample13');
  await closeItem();
  await openItem('I_sample26');
  await reply(held, 'I_sample26');
  expect(text(description())).toContain('Bumps FFmpeg');
  // The first item's late reply lands on a dialog that moved on.
  await reply(held, 'I_sample13');
  expect(text(inDialog('[data-slot="dialog-title"]'))).toContain('Bump FFmpeg');
  expect(text(description())).toContain('Bumps FFmpeg');
  expect(text(description())).not.toContain('Owner accounts');
});
