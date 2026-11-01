// Editing a ticket's labels in the item dialog: the picker reads the tracker's labels when it opens, each toggle writes
// one label, and the row changes only once the write succeeds. A failed write leaves the labels and shows the error.

import { expect, test } from 'vite-plus/test';
import { $, $$, detailsRead, detailsReply, fetchMock, mountPage, sample, settle, text } from '../../test/support.ts';
import { effectiveVocabulary } from '@lar-factory/shared';
import type { BoardData, Item, RepositorySetup, TrackerLabel } from '@lar-factory/shared';

const ID = 'I_sample05';
const ticket = sample.items.find((i) => i.id === ID)!;
const LIST: TrackerLabel[] = [{ name: 'area: server', color: 'B60205', description: 'The server' }, { name: 'docs', color: '0E8A16' }, { name: 'needs-design' }, { name: 'type: improvement' }];
const vocabulary = effectiveVocabulary({ improvement: { type: null, labels: ['type: improvement'] } }).vocabulary;
const setup = (access: object = { 'tag-ticket': 'allowed' }, more: object = {}) => ({ access, vocabulary, ...more }) as unknown as RepositorySetup;

const boardWith = (item: Partial<Item>, repoSetup: RepositorySetup = setup()): BoardData => ({
  ...sample, repos: sample.repos.map((r) => (r.repo === ticket.repo ? { ...r, setup: repoSetup } : r)), items: sample.items.map((i) => (i.id === ID ? { ...i, ...item } : i)),
});

/** Serves the board and the labels, holding each label write until the test answers it. */
function serve(board: BoardData, list: Response | (() => Response) = () => new Response(JSON.stringify({ labels: LIST }))) {
  const writes: ((status: number, body: object) => Promise<void>)[] = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const itemId = detailsRead(url);
    if (itemId) return detailsReply(itemId);
    if (url.startsWith('/api/item-labels?')) return typeof list === 'function' ? list() : list;
    if (url === '/api/item-labels' && init?.method === 'POST') return new Promise<Response>((resolve) => {
      writes.push((status, body) => settle(() => resolve(new Response(JSON.stringify(body), { status }))));
    });
    return new Response(JSON.stringify(board));
  });
  return { answer: (status: number, body: object) => writes.shift()!(status, body) };
}

const sentWrites = () => (fetchMock.mock.calls as unknown as [string, RequestInit?][]).filter(([url, init]) => url === '/api/item-labels' && init?.method === 'POST').map(([, init]) => JSON.parse(init!.body as string) as object);
const sentReads = () => (fetchMock.mock.calls as unknown as [string][]).filter(([url]) => url.startsWith('/api/item-labels?'));
async function openItem(itemId = ID): Promise<void> {
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(itemId));
}
const pencil = () => $<HTMLButtonElement>('[data-item-dialog] [data-edit-labels]');
const openPicker = () => settle(() => pencil()!.click());
const choices = () => $$<HTMLLabelElement>('[data-label-choice]');
const choice = (name: string) => choices().find((c) => text(c).startsWith(name))!;
const toggle = (name: string) => settle(() => choice(name).querySelector('input')!.click());
const chips = () => $$('[data-item-dialog] [data-labels] [data-label-chip]').map((c) => text(c));

test('the picker offers the tracker\'s labels in their colours, ticks those on the ticket and locks the one the kind sets', async () => {
  serve(boardWith({ labels: ['improvement', 'needs-design', 'type: improvement'] }));
  await mountPage(boardWith({ labels: ['improvement', 'needs-design', 'type: improvement'] }));
  await openItem();
  expect(chips(), 'the kind\'s mapped label stays off the chips').toEqual(['needs-design']);
  await openPicker();
  expect(choices().map((c) => text(c))).toEqual(['area: serverThe server', 'docs', 'needs-design', 'type: improvement · set by kind']);
  expect(choice('needs-design').querySelector('input')!.checked).toBe(true);
  expect(choice('docs').querySelector('input')!.checked).toBe(false);
  expect(choice('type: improvement').querySelector('input')!.disabled).toBe(true);
  expect(choice('docs').querySelector<HTMLElement>('[data-label-dot]')!.style.background).toBe('rgb(14, 138, 22)');
});

test('typing narrows the picker', async () => {
  serve(boardWith({}));
  await mountPage(boardWith({}));
  await openItem();
  await openPicker();
  const input = $<HTMLInputElement>('[data-label-picker] input:not([type="checkbox"])')!;
  await settle(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'DOC');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(choices().map((c) => text(c))).toEqual(['docs']);
});

test('adding a label writes that one label, and the chip shows only once the write succeeds', async () => {
  const before = boardWith({ labels: ['needs-design'] });
  const { answer } = serve(before);
  await mountPage(before);
  await openItem();
  await openPicker();
  await toggle('docs');
  expect(sentWrites()).toEqual([{ itemId: ID, label: 'docs', action: 'add' }]);
  expect(chips()).toEqual(['needs-design']);
  await answer(200, { error: null, board: boardWith({ labels: ['needs-design', 'docs'] }) });
  expect(chips()).toEqual(['needs-design', 'docs']);
  expect(choice('docs').querySelector('input')!.checked).toBe(true);
  expect(text($('[data-label-picker]')?.parentElement)).not.toMatch(/Could not/);
});

test('removing a label writes only its removal', async () => {
  const before = boardWith({ labels: ['needs-design', 'docs'] });
  const { answer } = serve(before);
  await mountPage(before);
  await openItem();
  await openPicker();
  await toggle('docs');
  expect(sentWrites()).toEqual([{ itemId: ID, label: 'docs', action: 'remove' }]);
  await answer(200, { error: null, board: boardWith({ labels: ['needs-design'] }) });
  expect(chips()).toEqual(['needs-design']);
});

test('a second toggle waits for the write in flight', async () => {
  const before = boardWith({ labels: [] });
  const { answer } = serve(before);
  await mountPage(before);
  await openItem();
  await openPicker();
  await toggle('docs');
  await toggle('needs-design');
  expect(sentWrites()).toHaveLength(1);
  await answer(200, { error: null, board: boardWith({ labels: ['docs'] }) });
});

test('a failed write leaves the labels as they were and shows the error, closed or open', async () => {
  const before = boardWith({ labels: ['needs-design'] });
  const { answer } = serve(before);
  await mountPage(before);
  await openItem();
  await openPicker();
  await toggle('docs');
  await answer(502, { error: 'Could not change the labels on #129. gh failed: HTTP 403' });
  expect(chips()).toEqual(['needs-design']);
  expect(choice('docs').querySelector('input')!.checked).toBe(false);
  const alerts = () => $$('[role="alert"]').map((a) => text(a));
  expect(alerts()).toEqual(['Could not change the labels on #129. gh failed: HTTP 403']);
  await settle(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect($('[data-label-picker]')).toBeNull();
  expect(alerts()).toEqual(['Could not change the labels on #129. gh failed: HTTP 403']);
});

test('on Azure the control says tags, has no colours and writes the same way', async () => {
  const repo = 'contoso/Fabrikam/web';
  const azure = (labels: string[]): BoardData => ({ ...sample,
    repos: [...sample.repos, { repo, role: 'Web client', items: 'azure-board', team: 'Web', labels: [], setup: setup() } as BoardData['repos'][number]],
    items: sample.items.map((i) => (i.id === ID ? { ...i, repo, number: 310, labels, labelColors: {} } : i)) });
  const { answer } = serve(azure(['docs']), () => new Response(JSON.stringify({ labels: [{ name: 'docs' }, { name: 'area-ui' }] })));
  await mountPage(azure(['docs']));
  await openItem();
  expect(pencil()!.getAttribute('aria-label')).toBe('Edit tags');
  await openPicker();
  expect($<HTMLInputElement>('[data-label-picker] input')!.placeholder).toBe('Filter tags');
  expect(choice('area-ui').querySelector('[data-label-dot]')).toBeNull();
  await toggle('area-ui');
  await answer(502, { error: 'Could not change the tags on #310. az rest failed: TF26071' });
  expect(chips()).toEqual(['docs']);
  expect(text($('[role="alert"]'))).toContain('TF26071');
  await toggle('area-ui');
  await answer(200, { error: null, board: azure(['docs', 'area-ui']) });
  expect(chips()).toEqual(['docs', 'area-ui']);
  expect($('[role="alert"]')).toBeNull();
  expect(sentWrites()).toEqual([{ itemId: ID, label: 'area-ui', action: 'add' }, { itemId: ID, label: 'area-ui', action: 'add' }]);
});

test('without tag-ticket access the control is disabled with the reason and reads nothing', async () => {
  const refused = boardWith({ labels: ['docs'] }, setup({ 'tag-ticket': 'refused' }));
  serve(refused);
  await mountPage(refused);
  await openItem();
  expect(pencil()!.disabled).toBe(true);
  expect(pencil()!.title).toBe('Access to tag-ticket was refused. Recheck access in Settings.');
  expect(chips()).toEqual(['docs']);
  expect(sentReads()).toEqual([]);
});

test('the Azure read-only safety disables the control with its reason', async () => {
  const repo = 'contoso/Fabrikam/web';
  const azure: BoardData = { ...sample,
    repos: [...sample.repos, { repo, role: 'Web client', items: 'azure-board', team: 'Web', labels: [], setup: setup({ 'tag-ticket': 'allowed' }, { azureReadOnly: true }) } as BoardData['repos'][number]],
    items: sample.items.map((i) => (i.id === ID ? { ...i, repo, number: 310 } : i)) };
  serve(azure);
  await mountPage(azure);
  await openItem();
  expect(pencil()!.title).toBe('Azure DevOps is read-only in this test session.');
});

test('a ticket with no labels can still add one', async () => {
  const none = boardWith({ labels: ['improvement'] });
  serve(none);
  await mountPage(none);
  await openItem();
  expect(chips()).toEqual([]);
  expect(pencil()!.disabled).toBe(false);
});

test('a failed read says why, and opening again reads again', async () => {
  let fails = true;
  const board = boardWith({});
  serve(board, () => (fails ? new Response(JSON.stringify({ error: 'Could not read the labels. gh failed: HTTP 502' }), { status: 502 }) : new Response(JSON.stringify({ labels: LIST }))));
  await mountPage(board);
  await openItem();
  await openPicker();
  expect(text($('[role="alert"]'))).toBe('Could not read the labels. gh failed: HTTP 502');
  fails = false;
  await settle(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await openPicker();
  expect(choices()).toHaveLength(4);
  expect($('[role="alert"]')).toBeNull();
});

test('local work has no label control and says how to get labels', async () => {
  const local = boardWith({ number: 0, labels: [], url: '' });
  serve(local);
  await mountPage(local);
  await openItem();
  expect(pencil()).toBeNull();
  expect(text($('[data-item-dialog] [data-local-labels]'))).toBe('Local work has no ticket, so it has a kind alone. Create a ticket to add labels.');
});
