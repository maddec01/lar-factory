// Changing an item's kind in the item dialog: an ordinary item offers the three kinds, the write goes through the board and
// the row changes from its answer. A failure keeps the old kind, says what changed on the ticket, and Retry sends the same change.

import type { BoardData, Item, KindDisagreement } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import {
    $,
    $$,
    chooseOption,
    detailsRead,
    detailsReply,
    fetchMock,
    mountPage,
    sample,
    settle,
    text,
} from '@/test/PageTest';

const ID = 'I_sample05';
const boardWith = (item: Partial<Item>): BoardData => ({
    ...sample,
    items: sample.items.map((i) => (i.id === ID ? { ...i, ...item } : i)),
});

/** Serves the board, holding each kind write until the test answers it. */
function serve(board: BoardData, details?: object) {
    const writes: ((status: number, body: object) => Promise<void>)[] = [];

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        const itemId = detailsRead(url);

        if (itemId)
            return details
                ? new Response(
                      JSON.stringify({
                          details: {
                              body: '',
                              format: 'markdown',
                              author: null,
                              assignees: [],
                              createdAt: null,
                              subTickets: [],
                              comments: [],
                              hasOlderComments: false,
                              olderCursor: null,
                              ...details,
                          },
                      }),
                  )
                : detailsReply(itemId);

        if ((url === '/api/item-kind' || url === '/api/item-kind-answer') && init?.method === 'POST')
            return new Promise<Response>((resolve) => {
                writes.push((status, body) => settle(() => resolve(new Response(JSON.stringify(body), { status }))));
            });

        return new Response(JSON.stringify(board));
    });

    return { answer: (status: number, body: object) => writes.shift()!(status, body) };
}

const sentTo = (path: string) =>
    (fetchMock.mock.calls as unknown as [string, RequestInit?][])
        .filter(([url, init]) => url === path && init?.method === 'POST')
        .map(([, init]) => JSON.parse(init!.body as string) as object);
const sent = () => sentTo('/api/item-kind');

async function openItem(itemId = ID): Promise<void> {
    const { useItemDialogStore } = await import('./ItemDialogStore');

    await settle(() => useItemDialogStore.getState().open(itemId));
}

const control = () => $('[data-item-dialog] [data-item-summary] [role="combobox"][aria-label="Kind"]');
const shownKind = () => text(control());
const choose = (name: string) => chooseOption(control()!, name);
const retry = () => $$<HTMLButtonElement>('[data-kind-change-failed] button').find((b) => text(b) === 'Try again')!;

test('changing the kind writes it, and the control and line follow the board’s answer', async () => {
    const before = boardWith({ kind: 'bug' });
    const { answer } = serve(before);

    await mountPage(before);
    await openItem();
    await choose('Feature');
    expect(sent()).toEqual([{ itemId: ID, kind: 'feature' }]);
    expect(shownKind()).toBe('Bug');
    expect(control()!.hasAttribute('disabled')).toBe(true);
    await answer(200, {
        error: null,
        itemId: ID,
        line: '#129: removed label bug; added label feature.',
        board: boardWith({ kind: 'feature' }),
    });
    expect(shownKind()).toBe('Feature');
    expect(text($('[data-kind-change-line]'))).toBe('#129: removed label bug; added label feature.');
    expect($('[data-kind-change-failed]')).toBeNull();
});

test('a failure keeps the old kind, says what changed, and Retry sends the same change', async () => {
    const before = boardWith({ kind: 'bug' });
    const { answer } = serve(before);

    await mountPage(before);
    await openItem();
    await choose('Feature');
    await answer(502, {
        error: 'Couldn’t finish changing #129 to Feature. gh failed: HTTP 403',
        itemId: ID,
        line: '#129: added label feature.',
        board: before,
    });
    expect(shownKind()).toBe('Bug');

    const failed = text($('[data-kind-change-failed]'));

    expect(failed).toContain('Couldn’t finish changing #129 to Feature. gh failed: HTTP 403');
    expect(failed).toContain('Changed on the ticket so far: #129: added label feature.');
    await settle(() => retry().click());
    expect(sent()).toEqual([
        { itemId: ID, kind: 'feature' },
        { itemId: ID, kind: 'feature' },
    ]);
    await answer(200, {
        error: null,
        itemId: ID,
        line: '#129: removed label bug.',
        board: boardWith({ kind: 'feature' }),
    });
    expect(shownKind()).toBe('Feature');
    expect($('[data-kind-change-failed]')).toBeNull();
});

const SWAP = { add: ['type: feature'], remove: ['type: bug'], type: { from: 'Bug', to: 'Feature' } };
const ticketMoved: KindDisagreement = { ticketKind: 'bug', changed: 'ticket', kept: false, swap: SWAP };
const notice = () => $('[data-item-dialog] [data-kind-notice]');
const noticeButtons = () => $$<HTMLButtonElement>('[data-item-dialog] [data-kind-notice] button');
const noticeButton = (name: string) => noticeButtons().find((b) => text(b) === name)!;
const ALLOWED = { 'tag-ticket': 'allowed', 'type-ticket': 'allowed' };
const withAccess = (board: BoardData, access: object = ALLOWED): BoardData => ({
    ...board,
    repos: board.repos.map((r) =>
        r.repo === sample.items.find((i) => i.id === ID)!.repo
            ? { ...r, setup: { ...r.setup, access } as NonNullable<typeof r.setup> }
            : r,
    ),
});
const opened = async (item: Partial<Item>, access?: object, details?: object) => {
    const board = withAccess(boardWith(item), access);
    const server = serve(board, details);

    await mountPage(board);
    await openItem();

    return server;
};

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
