// Changing an item's kind in the item dialog: an ordinary item offers the three kinds, the write goes through the board and
// the row changes from its answer. A failure keeps the old kind, says what changed on the ticket, and Retry sends the same change.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, chooseOption, detailsRead, detailsReply, fetchMock, mountPage, openOptions, sample, settle, text } from '../../test/support.ts';
import type { BoardData, Item, KindDisagreement, Kind } from '@lar-factory/shared';

const ID = 'I_sample05';
const boardWith = (item: Partial<Item>): BoardData => ({ ...sample, items: sample.items.map((i) => (i.id === ID ? { ...i, ...item } : i)) });

/** Serves the board, holding each kind write until the test answers it. */
function serve(board: BoardData, details?: object) {
  const writes: ((status: number, body: object) => Promise<void>)[] = [];
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const itemId = detailsRead(url);
    if (itemId) return details ? new Response(JSON.stringify({ details: { body: '', format: 'markdown', author: null, assignees: [], createdAt: null, subTickets: [], comments: [], hasOlderComments: false, olderCursor: null, ...details } })) : detailsReply(itemId);
    if ((url === '/api/item-kind' || url === '/api/item-kind-answer') && init?.method === 'POST') return new Promise<Response>((resolve) => {
      writes.push((status, body) => settle(() => resolve(new Response(JSON.stringify(body), { status }))));
    });
    return new Response(JSON.stringify(board));
  });
  return { answer: (status: number, body: object) => writes.shift()!(status, body) };
}
const sentTo = (path: string) => (fetchMock.mock.calls as unknown as [string, RequestInit?][]).filter(([url, init]) => url === path && init?.method === 'POST').map(([, init]) => JSON.parse(init!.body as string) as object);
const sent = () => sentTo('/api/item-kind');
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
const detailsReads = () => (fetchMock.mock.calls as unknown as [string][]).filter(([url]) => detailsRead(url)).length;
/** Holds each details read from here on until the test calls the function this returns, which answers the latest. */
function holdDetails(): () => Promise<void> {
  const serving = fetchMock.getMockImplementation() as unknown as (url: string, init?: RequestInit) => Promise<Response>;
  let release = () => {};
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => (detailsRead(url) ? new Promise<Response>((resolve) => { release = () => resolve(serving(url, init)); }) : serving(url, init)));
  return () => settle(() => release());
}

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

const SWAP = { add: ['type: feature'], remove: ['type: bug'], type: { from: 'Bug', to: 'Feature' } };
const itemMoved: KindDisagreement = { ticketKind: 'bug', changed: 'item', kept: false, swap: SWAP };
const ticketMoved: KindDisagreement = { ticketKind: 'bug', changed: 'ticket', kept: false, swap: SWAP };
const notice = () => $('[data-item-dialog] [data-kind-notice]');
const noticeButtons = () => $$<HTMLButtonElement>('[data-item-dialog] [data-kind-notice] button');
const noticeButton = (name: string) => noticeButtons().find((b) => text(b) === name)!;
const ALLOWED = { 'tag-ticket': 'allowed', 'type-ticket': 'allowed' };
const TYPE_REFUSED = { 'tag-ticket': 'allowed', 'type-ticket': 'refused' };
const FEATURE_PLAN = { itemKind: 'feature', ticketKind: 'bug', swap: { add: ['type: feature'], remove: ['type: bug'], type: null }, note: " The type stays Bug, because the team's backlog doesn't show Feature." };
const withAccess = (board: BoardData, access: object = ALLOWED): BoardData => ({ ...board, repos: board.repos.map((r) => (r.repo === sample.items.find((i) => i.id === ID)!.repo ? { ...r, setup: { ...r.setup, access } as NonNullable<typeof r.setup> } : r)) });
const opened = async (item: Partial<Item>, access?: object, details?: object) => {
  const board = withAccess(boardWith(item), access);
  const server = serve(board, details);
  await mountPage(board);
  await openItem();
  return server;
};

test('when the item changed, the notice offers updating the ticket and names what it swaps', async () => {
  const { answer } = await opened({ kind: 'feature', kindDisagreement: itemMoved });
  expect(text(notice())).toContain('Shaping decided this is a Feature. The ticket still says Bug.');
  expect(noticeButtons().map((b) => text(b))).toEqual(['Update ticket to Feature', 'Keep ticket as Bug']);
  expect(text($('[data-kind-notice-hint]'))).toBe('Update changes #129: label type: bug → type: feature, type Bug → Feature.');
  await settle(() => noticeButton('Update ticket to Feature').click());
  expect(sent()).toEqual([{ itemId: ID, kind: 'feature' }]);
  await answer(200, { error: null, itemId: ID, line: '#129: added label type: feature.', board: boardWith({ kind: 'feature' }) });
  expect(notice()).toBeNull();
});

test('the notice takes what an update writes from the details: a backlog-hidden type is dropped, says so, and needs no type access', async () => {
  await opened({ kind: 'feature', kindDisagreement: itemMoved }, TYPE_REFUSED, { kindPlan: FEATURE_PLAN });
  expect(text($('[data-kind-notice-hint]'))).toBe("Update changes #129: label type: bug → type: feature. The type stays Bug, because the team's backlog doesn't show Feature.");
  expect(noticeButton('Update ticket to Feature').disabled).toBe(false);
});

test('an update that a backlog-hidden type leaves with nothing to write says that, and why', async () => {
  const kindPlan = { itemKind: 'feature', ticketKind: 'bug', swap: { add: [], remove: [], type: null }, note: " The type stays Bug, because the team's backlog doesn't show Feature." };
  await opened({ kind: 'feature', kindDisagreement: itemMoved }, ALLOWED, { kindPlan });
  expect(text($('[data-kind-notice-hint]'))).toBe("Update writes nothing to #129. The type stays Bug, because the team's backlog doesn't show Feature.");
});

test('while the details load, Update waits and says it is checking', async () => {
  const board = withAccess(boardWith({ kind: 'feature', kindDisagreement: itemMoved }));
  serve(board, { kindPlan: { ...FEATURE_PLAN, swap: SWAP, note: '' } });
  const release = holdDetails();
  await mountPage(board);
  await openItem();
  expect(noticeButton('Update ticket to Feature').disabled).toBe(true);
  expect(text($('[data-kind-notice-hint]'))).toBe('Checking what the update changes…');
  const reads = detailsReads();
  await release();
  expect(noticeButton('Update ticket to Feature').disabled).toBe(false);
  expect(text($('[data-kind-notice-hint]'))).toBe('Update changes #129: label type: bug → type: feature, type Bug → Feature.');
  expect(detailsReads(), 'a plan for these kinds needs no second read').toBe(reads);
});

test('details with no plan are read once more, and then the board\'s own swap stands in', async () => {
  const board = withAccess(boardWith({ kind: 'feature', kindDisagreement: itemMoved }));
  serve(board);
  const release = holdDetails();
  await mountPage(board);
  await openItem();
  const reads = detailsReads();
  await release();
  expect(text($('[data-kind-notice-hint]'))).toBe('Checking what the update changes…');
  expect(noticeButton('Update ticket to Feature').disabled).toBe(true);
  await release();
  expect(text($('[data-kind-notice-hint]'))).toBe('Update changes #129: label type: bug → type: feature, type Bug → Feature.');
  expect(noticeButton('Update ticket to Feature').disabled).toBe(false);
  expect(detailsReads()).toBe(reads + 1);
});

test('an item-only change with the dialog open checks again, and shows no plan for the earlier kind', async () => {
  const details = { kindPlan: FEATURE_PLAN as object };
  const { answer } = await opened({ kind: 'feature', kindDisagreement: itemMoved }, TYPE_REFUSED, details);
  expect(noticeButton('Update ticket to Feature').disabled).toBe(false);
  const release = holdDetails();
  await choose('Improvement');
  const swap = { add: [], remove: ['type: bug'], type: { from: 'Bug', to: 'Improvement' } };
  details.kindPlan = { itemKind: 'improvement', ticketKind: 'bug', swap: { ...swap, type: null }, note: " The type stays Bug, because the team's backlog doesn't show Improvement." };
  await answer(200, { error: null, itemId: ID, line: 'This item is now Improvement. Its ticket stays as it is: Access to type-ticket was refused. Recheck access in Settings.', board: withAccess(boardWith({ kind: 'improvement', kindDisagreement: { ...itemMoved, swap } }), TYPE_REFUSED) });
  expect(noticeButton('Update ticket to Improvement').disabled).toBe(true);
  expect(text($('[data-kind-notice-hint]'))).toBe('Checking what the update changes…');
  await release();
  expect(noticeButton('Update ticket to Improvement').disabled).toBe(false);
  expect(text($('[data-kind-notice-hint]'))).toBe("Update changes #129: label type: bug → none. The type stays Bug, because the team's backlog doesn't show Improvement.");
});

test('an item-only change on an item with no plan at open uses the board\'s swap once the read finds none', async () => {
  const before = withAccess(boardWith({ kind: 'bug' }), TYPE_REFUSED);
  const { answer } = serve(before);
  await mountPage(before);
  await openItem();
  await choose('Feature');
  await answer(200, { error: null, itemId: ID, line: 'This item is now Feature.', board: withAccess(boardWith({ kind: 'feature', kindDisagreement: itemMoved }), TYPE_REFUSED) });
  expect(noticeButton('Update ticket to Feature').disabled).toBe(true);
  expect(text($('[data-kind-notice-hint]'))).toContain('Access to type-ticket was refused');
});

test('reopening after the ticket changed, with updatedAt unmoved, reads the details again', async () => {
  const details = { kindPlan: FEATURE_PLAN as object };
  await opened({ kind: 'feature', kindDisagreement: itemMoved }, TYPE_REFUSED, details);
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().close());
  const release = holdDetails();
  const { receive } = await import('../items/card-actions.ts');
  await settle(() => receive({ error: null, board: withAccess(boardWith({ kind: 'feature', kindDisagreement: { ...itemMoved, ticketKind: 'improvement' } }), TYPE_REFUSED) }));
  details.kindPlan = { ...FEATURE_PLAN, ticketKind: 'improvement', swap: { add: [], remove: [], type: null }, note: '' };
  await openItem();
  expect(text($('[data-kind-notice-hint]'))).toBe('Checking what the update changes…');
  await release();
  expect(text($('[data-kind-notice-hint]'))).toBe('Update writes nothing to #129, as Feature has no mapped label or type.');
});

test('opening an ordinary item leaves focus off Kind, and a letter key on the closed control changes nothing', async () => {
  const board = boardWith({ kind: 'bug' });
  serve(board);
  await mountPage(board);
  await openItem();
  expect(document.activeElement).not.toBe(control());
  control()!.focus();
  for (const key of ['f', 'F', 'i']) await settle(() => control()!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  await settle(() => vi.advanceTimersByTime(1100));
  expect(sent()).toEqual([]);
  expect(shownKind()).toBe('Bug');
  expect($('[role="listbox"]'), 'and the list stays closed').toBeNull();
  expect(await options(), 'arrows still open it').toEqual(['Bug', 'Feature', 'Improvement']);
});

test('focus comes back to Kind when a kind change ends with focus on the page', async () => {
  const board = boardWith({ kind: 'bug' });
  const { answer } = serve(board);
  await mountPage(board);
  await openItem();
  await choose('Feature');
  (document.activeElement as HTMLElement).blur();
  await answer(200, { error: null, itemId: ID, line: '#129: added label feature.', board: boardWith({ kind: 'feature' }) });
  expect(document.activeElement).toBe(control());
});

for (const [ending, status, body] of [['succeeds', 200, { error: null, itemId: ID, line: '#129: added label feature.', board: boardWith({ kind: 'feature' }) }], ['fails', 502, { error: 'Could not finish changing #129 to Feature.', itemId: ID, line: '', board: boardWith({ kind: 'bug' }) }]] as const) {
  test(`focus comes back to Kind from the dialog when a kind change ${ending}`, async () => {
    const board = boardWith({ kind: 'bug' });
    const { answer } = serve(board);
    await mountPage(board);
    await openItem();
    await choose('Feature');
    $('[data-item-dialog]')!.focus();
    expect(document.activeElement).toBe($('[data-item-dialog]'));
    await answer(status, body);
    expect(document.activeElement).toBe(control());
  });
}

test('a control the user moved to during a kind change keeps focus', async () => {
  const board = boardWith({ kind: 'bug' });
  const { answer } = serve(board);
  await mountPage(board);
  await openItem();
  await choose('Feature');
  const close = $('[data-item-dialog] [aria-label="Close"]')!;
  close.focus();
  await answer(200, { error: null, itemId: ID, line: '#129: added label feature.', board: boardWith({ kind: 'feature' }) });
  expect(document.activeElement).toBe(close);
});

test('an answer that leaves focus on the page brings it back to Kind', async () => {
  const { answer } = await opened({ kind: 'feature', kindDisagreement: ticketMoved });
  await settle(() => noticeButton('Keep item as Feature').click());
  (document.activeElement as HTMLElement).blur();
  await answer(200, { error: null, board: boardWith({ kind: 'feature' }) });
  expect(document.activeElement).toBe(control());
});

test('an Improvement reads with its article', async () => {
  await opened({ kind: 'improvement', kindDisagreement: itemMoved });
  expect(text(notice())).toContain('Shaping decided this is an Improvement.');
});

test('when the ticket changed, the notice offers updating the item and writes nothing to the ticket', async () => {
  const { answer } = await opened({ kind: 'feature', kindDisagreement: ticketMoved });
  expect(text(notice())).toContain('The ticket now says Bug. This item still says Feature.');
  expect(noticeButtons().map((b) => text(b))).toEqual(['Update item to Bug', 'Keep item as Feature']);
  expect(text($('[data-kind-notice-hint]'))).toBe('Changes this item only. Nothing is written to the ticket.');
  await settle(() => noticeButton('Update item to Bug').click());
  expect(sentTo('/api/item-kind-answer')).toEqual([{ itemId: ID, answer: 'update-item', ticketKind: 'bug' }]);
  expect(sent()).toEqual([]);
  await answer(200, { error: null, board: boardWith({ kind: 'bug' }) });
  expect(notice()).toBeNull();
  expect(shownKind()).toBe('Bug');
});

test('a ticket with no kind offers adding it, or leaving the ticket', async () => {
  await opened({ kind: 'bug', kindDisagreement: { ticketKind: null, changed: 'item', kept: false, swap: { add: ['type: bug'], remove: [], type: null } } });
  expect(text(notice())).toContain('Shaping decided this is a Bug. The ticket has no kind.');
  expect(noticeButtons().map((b) => text(b))).toEqual(['Add Bug to ticket', 'Leave ticket as is']);
  expect(text($('[data-kind-notice-hint]'))).toBe('Update changes #129: label none → type: bug.');
});

test('an update with nothing to write says so', async () => {
  await opened({ kind: 'improvement', kindDisagreement: { ...itemMoved, swap: { add: [], remove: [], type: null } } });
  expect(text($('[data-kind-notice-hint]'))).toBe('Update writes nothing to #129, as Improvement has no mapped label or type.');
});

test('Keep records the answer and leaves a line in details, whose Change shows the choice again', async () => {
  const { answer } = await opened({ kind: 'bug', kindDisagreement: { ...itemMoved, ticketKind: 'feature' } });
  await settle(() => noticeButton('Keep ticket as Feature').click());
  expect(sentTo('/api/item-kind-answer')).toEqual([{ itemId: ID, answer: 'keep', ticketKind: 'feature' }]);
  await answer(200, { error: null, board: withAccess(boardWith({ kind: 'bug', kindDisagreement: { ...itemMoved, ticketKind: 'feature', kept: true } })) });
  expect(notice()).toBeNull();
  const kept = $('[data-kind-kept]')!;
  expect(text(kept)).toBe('Ticket says Feature. Kept as is. Change');
  await settle(() => $<HTMLButtonElement>('[data-kind-kept] button')!.click());
  expect(noticeButtons().map((b) => text(b))).toEqual(['Update ticket to Bug', 'Keep ticket as Feature']);
});

test('a kept ticket with no kind says it was left', async () => {
  await opened({ kind: 'bug', kindDisagreement: { ticketKind: null, changed: 'item', kept: true, swap: SWAP } });
  expect(text($('[data-kind-kept]'))).toBe('Ticket has no kind. Left as is. Change');
});

test('a failed answer stays in the notice and changes nothing', async () => {
  const { answer } = await opened({ kind: 'feature', kindDisagreement: ticketMoved });
  await settle(() => noticeButton('Keep item as Feature').click());
  await answer(409, { error: 'The kinds changed. Check the updated item.' });
  expect(text($('[data-kind-notice] [role="alert"]'))).toBe('The kinds changed. Check the updated item.');
});

test('without label access Update ticket is disabled with the reason, and Keep still works', async () => {
  await opened({ kind: 'feature', kindDisagreement: itemMoved }, { 'tag-ticket': 'refused', 'type-ticket': 'allowed' });
  expect(noticeButton('Update ticket to Feature').disabled).toBe(true);
  expect(noticeButton('Keep ticket as Bug').disabled).toBe(false);
  expect(text($('[data-kind-notice-hint]'))).toContain('Access to tag-ticket was refused');
});

test('without label access Update item still works', async () => {
  await opened({ kind: 'feature', kindDisagreement: ticketMoved }, { 'tag-ticket': 'refused' });
  expect(noticeButton('Update item to Bug').disabled).toBe(false);
  expect(noticeButton('Keep item as Feature').disabled).toBe(false);
});

test('an item that agrees has no notice', async () => {
  await opened({ kind: 'bug' });
  expect(notice()).toBeNull();
  expect($('[data-kind-kept]')).toBeNull();
});
