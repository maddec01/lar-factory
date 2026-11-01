// Settings › Archive: set-aside and hidden work with Export markdown, Restore and Close ticket, and the retention
// setting, whose timed delete names the work it would delete and saves only on its own confirm.

import { expect, test } from 'vite-plus/test';
import type { BoardData, Item } from '@lar-factory/shared';
import { $, $$, fetchMock, mountPage, sample, settle, text } from '../../test/support.ts';

const base = sample.items.find((i) => i.id === 'I_sample13')!;
const archived = (id: string, title: string, archivedAs: Item['archived'], change: Partial<Item> = {}): Item =>
  ({ ...base, id, title, status: 'Queued', archived: archivedAs, ...change });
const aside = archived('W_aside', 'Put away', { setAside: true, hidden: false, ticketOpen: true }, { number: 41 });
const finished = archived('W_done', 'Shipped', { setAside: false, hidden: true, ticketOpen: false }, { status: 'Done', closedAt: '2026-10-01T09:00:00Z' });
const withRetention = (change: Partial<BoardData> = {}): BoardData =>
  ({ ...sample, retention: { hideAfterDays: 7, deleteAfterDays: null }, ...change });

const row = (id: string) => $(`.settings-row[data-row="${id}"]`)!;
const button = (scope: Element, label: string) => [...scope.querySelectorAll('button')].find((b) => text(b) === label);
const posted = (path: string) => fetchMock.mock.calls.filter(([url]) => url === path).map((call) => JSON.parse((call as unknown as [string, RequestInit])[1].body as string));
const archiveReads = () => fetchMock.mock.calls.filter(([url]) => url === '/api/archive').length;

/** The work /api/archive answers with now, which a reply can change. */
let shelved: Item[] = [];

/** Answers /api/archive with `shelved`, each POST to a path in `replies` with its body, and every other request with `board`. */
function answer(board: BoardData, replies: Record<string, (body: Record<string, unknown>) => object>) {
  fetchMock.mockImplementation((async (url: string, init?: RequestInit) => {
    if (url === '/api/archive') return new Response(JSON.stringify({ items: shelved }));
    const reply = replies[url];
    if (reply) return new Response(JSON.stringify(reply(JSON.parse(init!.body as string))));
    return new Response(JSON.stringify(board));
  }) as never);
}

/** Mounts the page on `data` and opens Settings › Archive, whose route answers with `items`. */
async function openArchive(data: BoardData, replies: Record<string, (body: Record<string, unknown>) => object> = {}, items = [aside, finished]): Promise<void> {
  shelved = items;
  answer(data, replies);
  await mountPage(data);
  await settle(() => $<HTMLButtonElement>('.open-settings')!.click());
  expect(archiveReads(), 'Archive is read only once it opens').toBe(0);
  await settle(() => $$<HTMLButtonElement>('.settings-nav button').find((b) => text(b) === 'Archive')!.click());
}

test('Archive reads set-aside and hidden work when it opens, with Export markdown, and Restore and Close ticket only where they apply', async () => {
  await openArchive(withRetention());
  expect(archiveReads()).toBe(1);
  expect(text(row('archived-W_aside'))).toContain('Put away');
  expect(text(row('archived-W_aside'))).toContain('#41 · Set aside');
  expect(text(row('archived-W_done'))).toContain('Finished');
  expect(['Export markdown', 'Close ticket', 'Restore'].map((label) => !!button(row('archived-W_aside'), label))).toEqual([true, true, true]);
  expect(['Export markdown', 'Close ticket', 'Restore'].map((label) => !!button(row('archived-W_done'), label))).toEqual([true, false, false]);
});

test('archived rows identify local work and each ticket provider', async () => {
  const local = { ...aside, id: 'local', repo: 'example/product', number: 0, url: null };
  await openArchive(withRetention(), {}, [local,
    { ...local, id: 'github', number: 17, url: 'https://github.com/example/product/issues/17' },
    { ...local, id: 'azure', repo: 'example/project/product', number: 23, url: 'https://dev.azure.com/example/project/_workitems/edit/23' },
  ]);
  expect(row('archived-local').querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Saved only on this machine.');
  expect(row('archived-github').querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('GitHub issue. Saved on GitHub.');
  expect(row('archived-azure').querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Azure DevOps work item. Saved in Azure DevOps.');
});

test('Restore posts the work, and the row leaves Archive as Archive is read again', async () => {
  const restored = withRetention({ items: [...sample.items, { ...aside, archived: undefined }] });
  await openArchive(withRetention(), { '/api/restore': () => (shelved = [finished], { error: null, board: restored }) });
  await settle(() => button(row('archived-W_aside'), 'Restore')!.click());
  expect(posted('/api/restore')).toEqual([{ itemId: 'W_aside' }]);
  expect(archiveReads()).toBe(2);
  expect($('.settings-row[data-row="archived-W_aside"]')).toBeNull();
});

test("Close ticket asks as Abandon's own step does, and closes only on its confirm", async () => {
  await openArchive(withRetention(), { '/api/close-ticket': () => ({ error: null }) });
  await settle(() => button(row('archived-W_aside'), 'Close ticket')!.click());
  const confirm = $('#abandon-dialog')!;
  expect(confirm.getAttribute('data-abandon-step')).toBe('close-ticket');
  expect(posted('/api/close-ticket')).toEqual([]);
  await settle(() => button(confirm, 'Close issue')!.click());
  expect(posted('/api/close-ticket')).toEqual([{ itemId: 'W_aside' }]);
});

test('a timed delete names the work it would delete and saves only on its confirm; the report names the work it kept', async () => {
  const kept = { hideAfterDays: 7, deleteAfterDays: 30, lastDelete: { at: '2026-10-21T09:00:00Z', deleted: ['W_old'],
    kept: [{ workId: 'W_done', reason: 'It owns the slice W_slice, which is kept.' }] } };
  await openArchive(withRetention(), { '/api/retention': (body) => body.confirmed
    ? (shelved = [aside], { error: null, saved: true, board: withRetention({ retention: kept }) })
    : { error: null, saved: false, due: [{ workId: 'W_done', title: 'Shipped' }] } });
  const setting = $('[data-retention]')!;
  await settle(() => $$<HTMLButtonElement>('[data-retention] [role="radio"]').find((r) => r.value === 'delete')!.click());
  await settle(() => $<HTMLButtonElement>('[data-save-retention]')!.click());
  expect(posted('/api/retention')).toEqual([{ hideAfterDays: 7, deleteAfterDays: 30, confirmed: false }]);
  expect(text($('[data-delete-confirm]'))).toContain('Shipped');
  expect(text(row('archived-W_done')), 'its Export markdown is still there').toContain('Export markdown');
  await settle(() => $<HTMLButtonElement>('[data-confirm-delete]')!.click());
  expect(posted('/api/retention').at(-1)).toEqual({ hideAfterDays: 7, deleteAfterDays: 30, confirmed: true });
  expect($('.settings-row[data-row="archived-W_done"]')).toBeNull();
  expect(text(setting.closest('.settings-body')!.querySelector('[data-last-delete]'))).toContain('deleted 1 record.');
  expect(text($('[data-last-delete]'))).toContain('Kept W_done. It owns the slice W_slice, which is kept.');
});

test('sample mode keeps no work records, so Archive offers nothing', async () => {
  await openArchive(sample, {}, []);
  expect(text($('.settings-body'))).toContain('Sample mode keeps no work records.');
  expect($$('.settings-body button')).toHaveLength(0);
});
