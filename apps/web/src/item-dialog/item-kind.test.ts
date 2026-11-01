// Changing an item's kind in the item dialog: an ordinary item offers the three kinds, the write goes through the board and
// the row changes from its answer. A failure keeps the old kind, says what changed on the ticket, and Retry sends the same change.

import { expect, test } from 'vite-plus/test';
import { $, $$, chooseOption, detailsRead, detailsReply, fetchMock, mountPage, openOptions, sample, settle, text } from '../../test/support.ts';
import type { BoardData, Item, Kind } from '@lar-factory/shared';

const ID = 'I_sample05';
const boardWith = (item: Partial<Item>): BoardData => ({ ...sample, items: sample.items.map((i) => (i.id === ID ? { ...i, ...item } : i)) });

/** Serves the board, holding each kind write until the test answers it. */
function serve(board: BoardData) {
  const writes: ((status: number, body: object) => Promise<void>)[] = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const itemId = detailsRead(url);
    if (itemId) return detailsReply(itemId);
    if (url === '/api/item-kind' && init?.method === 'POST') return new Promise<Response>((resolve) => {
      writes.push((status, body) => settle(() => resolve(new Response(JSON.stringify(body), { status }))));
    });
    return new Response(JSON.stringify(board));
  });
  return { answer: (status: number, body: object) => writes.shift()!(status, body) };
}
const sent = () => (fetchMock.mock.calls as unknown as [string, RequestInit?][]).filter(([url, init]) => url === '/api/item-kind' && init?.method === 'POST').map(([, init]) => JSON.parse(init!.body as string) as object);
async function openItem(itemId = ID): Promise<void> {
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(itemId));
}
const control = () => $('[data-item-dialog] [data-item-kind-control] [role="combobox"]');
const shownKind = () => text(control());
const choose = (name: string) => chooseOption(control()!, name);
const options = async () => {
  await openOptions(control()!);
  return $$('[role="option"]').map((o) => text(o));
};
const retry = () => $$<HTMLButtonElement>('[data-kind-change-failed] button').find((b) => text(b) === 'Retry')!;

for (const [kind, shown] of [['bug', 'Bug'], ['feature', 'Feature'], ['improvement', 'Improvement'], ['issue', 'No kind']] as const) {
  test(`an item with ${kind === 'issue' ? 'no kind' : `the kind ${kind}`} shows it and offers the three kinds`, async () => {
    const board = boardWith({ kind });
    serve(board);
    await mountPage(board);
    await openItem();
    expect(shownKind()).toBe(shown);
    expect(await options()).toEqual(['Bug', 'Feature', 'Improvement']);
  });
}

for (const kind of ['concept', 'decision', 'build'] as Kind[]) {
  test(`a ${kind} has no kind control`, async () => {
    const board = boardWith({ kind });
    serve(board);
    await mountPage(board);
    await openItem();
    expect(control()).toBeNull();
  });
}

test('changing the kind writes it, and the control and line follow the board\'s answer', async () => {
  const before = boardWith({ kind: 'bug' });
  const { answer } = serve(before);
  await mountPage(before);
  await openItem();
  await choose('Feature');
  expect(sent()).toEqual([{ itemId: ID, kind: 'feature' }]);
  expect(shownKind()).toBe('Bug');
  expect(control()!.hasAttribute('disabled')).toBe(true);
  await answer(200, { error: null, itemId: ID, line: '#129: removed label bug; added label feature.', board: boardWith({ kind: 'feature' }) });
  expect(shownKind()).toBe('Feature');
  expect(text($('[data-kind-change-line]'))).toBe('#129: removed label bug; added label feature.');
  expect($('[data-kind-change-failed]')).toBeNull();
});

test('a change without access says it changed only the item', async () => {
  const before = boardWith({ kind: 'bug' });
  const { answer } = serve(before);
  await mountPage(before);
  await openItem();
  await choose('Feature');
  await answer(200, { error: null, itemId: ID, line: 'This item is now Feature. Its ticket stays as it is: Access to tag-ticket was refused. Recheck access in Settings.', board: boardWith({ kind: 'feature' }) });
  expect(shownKind()).toBe('Feature');
  expect(text($('[data-kind-change-line]'))).toContain('Its ticket stays as it is');
});

test('a failure keeps the old kind, says what changed, and Retry sends the same change', async () => {
  const before = boardWith({ kind: 'bug' });
  const { answer } = serve(before);
  await mountPage(before);
  await openItem();
  await choose('Feature');
  await answer(502, { error: 'Could not finish changing #129 to Feature. gh failed: HTTP 403', itemId: ID, line: '#129: added label feature.', board: before });
  expect(shownKind()).toBe('Bug');
  const failed = text($('[data-kind-change-failed]'));
  expect(failed).toContain('Could not finish changing #129 to Feature. gh failed: HTTP 403');
  expect(failed).toContain('Changed on the ticket so far: #129: added label feature.');
  await settle(() => retry().click());
  expect(sent()).toEqual([{ itemId: ID, kind: 'feature' }, { itemId: ID, kind: 'feature' }]);
  await answer(200, { error: null, itemId: ID, line: '#129: removed label bug.', board: boardWith({ kind: 'feature' }) });
  expect(shownKind()).toBe('Feature');
  expect($('[data-kind-change-failed]')).toBeNull();
});

test('a failed retry keeps what the first attempt changed', async () => {
  const before = boardWith({ kind: 'bug' });
  const { answer } = serve(before);
  await mountPage(before);
  await openItem();
  await choose('Feature');
  await answer(502, { error: 'Could not finish changing #129 to Feature. First', itemId: ID, line: '#129: added label feature.', board: before });
  await settle(() => retry().click());
  await answer(502, { error: 'Could not finish changing #129 to Feature. Second', itemId: ID, line: '', board: before });
  const failed = text($('[data-kind-change-failed]'));
  expect(failed).toContain('Second');
  expect(failed).toContain('Changed on the ticket so far: #129: added label feature.');
});

test('a failed change that wrote nothing says so', async () => {
  const before = boardWith({ kind: 'bug' });
  const { answer } = serve(before);
  await mountPage(before);
  await openItem();
  await choose('Feature');
  await answer(502, { error: 'Could not finish changing #129 to Feature. gh failed: HTTP 502', itemId: ID, line: '', board: before });
  expect(text($('[data-kind-change-failed]'))).toContain('Nothing changed on the ticket.');
});

test('an item with no record follows its new work ID', async () => {
  const before = boardWith({ kind: 'issue', recorded: false });
  const { answer } = serve(before);
  await mountPage(before);
  await openItem();
  await choose('Bug');
  const after: BoardData = { ...sample, items: sample.items.map((i) => (i.id === ID ? { ...i, id: 'work-1', kind: 'bug', recorded: true } : i)) };
  await answer(200, { error: null, itemId: 'work-1', line: '#129: added label bug.', board: after });
  expect(shownKind()).toBe('Bug');
  expect(text($('[data-kind-change-line]'))).toBe('#129: added label bug.');
});

test('local work changes kind the same way', async () => {
  const local = boardWith({ kind: 'bug', number: 0, labels: [], url: '' });
  const { answer } = serve(local);
  await mountPage(local);
  await openItem();
  await choose('Improvement');
  await answer(200, { error: null, itemId: ID, line: 'This item is now Improvement. Local work has no ticket to change.', board: boardWith({ kind: 'improvement', number: 0, labels: [], url: '' }) });
  expect(shownKind()).toBe('Improvement');
  expect(text($('[data-kind-change-line]'))).toBe('This item is now Improvement. Local work has no ticket to change.');
});
