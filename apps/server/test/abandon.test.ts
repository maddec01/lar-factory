import type { BoardData } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { changeRecords, startableEnv, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

const abandon = (board: Board, itemId: string, origin = board.url) =>
    board.postSession({ itemId }, '/api/abandon', origin);
const closeTicket = (board: Board, itemId: string) => board.postSession({ itemId }, '/api/close-ticket');

const has = (data: BoardData, id: string) => data.items.some((i) => i.id === id);
const writes = async (board: Board) =>
    (await board.calls()).filter((args) => args[1] === 'close' || args[1] === 'item-delete');

async function reads(board: Board, n: number): Promise<void> {
    const count = async () => (await board.calls()).filter((args) => args[1] === 'graphql').length;
    const target = (await count()) + n;

    while ((await count()) < target) await new Promise((r) => setTimeout(r, 20));
}

/** Waits until a provider pass that began after this call has finished, as the next pass starts only once the last is done. */
async function providerPass(board: Board): Promise<void> {
    const count = async () =>
        (await board.calls()).filter(
            (args) => args[0] === 'issue' && args[1] === 'view' && args.includes('state,assignees'),
        ).length;
    const target = (await count()) + 2;

    while ((await count()) < target) await new Promise((r) => setTimeout(r, 20));
}

test('Abandon sets the item aside and the board drops it at once, and only Close ticket closes the issue as not planned', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(12, 'List'), boardIssue(13, 'List')] });

    await until(board, (d) => d.items.length === 2);

    const response = await abandon(board, board.id(12));

    assert.equal(response.status, 200);

    const result = await response.json();

    assert.equal(result.error, null);
    assert.ok(!has(result.board, board.id(12)));
    assert.ok(has(result.board, board.id(13)));
    assert.deepEqual(await writes(board), []);
    assert.equal((await closeTicket(board, board.id(12))).status, 200);
    assert.deepEqual(await writes(board), [
        ['issue', 'close', '12', '-R', 'maddec01/lar-factory', '--reason', 'not planned'],
    ]);
});

test('a failed ticket close reports the error, and the work stays set aside', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(12, 'List')], fail: 'abandon' });

    await until(board, (d) => d.items.length === 1);
    assert.equal((await abandon(board, board.id(12))).status, 200);

    const response = await closeTicket(board, board.id(12));

    assert.equal(response.status, 502);

    const result = await response.json();

    assert.match(result.error, /Could not abandon #12\. .*write access/);
    assert.ok(!has(await board.board(), board.id(12)));
});

test('an abandoned item does not come back while GitHub still reports it', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(12, 'List')] }, false, true);

    await until(board, (d) => d.items.length === 1);

    const response = await abandon(board, board.id(12));

    assert.equal(response.status, 200, await response.text());
    await reads(board, 5);

    const data = (await board.board()) as BoardData;

    assert.ok(!has(data, board.id(12)));
});

test('Abandon rejects requests from other pages and sample mode', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(12, 'List')] });

    await until(board, (d) => d.items.length === 1);
    for (const origin of ['https://evil.example', 'null', ''])
        assert.equal((await abandon(board, board.id(12), origin)).status, 403);
    assert.deepEqual(await writes(board), []);

    const sample = await startBoard(t, {}, true);

    assert.equal((await abandon(sample, 'I_sample01')).status, 403);
    assert.equal((await sample.calls()).length, 0);
});

const startItem = (board: Board, itemId: string) => board.postSession({ itemId }, '/api/start');

test('Abandon is refused while a Start is in flight, uncertain or done for the item', async (t) => {
    const refused = 'Start is running or has run for this item. Check its T3 thread before abandoning it.';
    const board = await startBoard(
        t,
        { items: [boardIssue(12, 'Queued')], t3: { delay: 300 } },
        false,
        false,
        startableEnv(t),
    );

    await until(board, (d) => d.items.length === 1);

    const starting = startItem(board, board.id(12));

    await new Promise((r) => setTimeout(r, 100));

    const inFlight = await abandon(board, board.id(12));

    assert.equal(inFlight.status, 409);
    assert.equal((await inFlight.json()).error, refused);
    assert.equal((await starting).status, 200);
    assert.equal((await abandon(board, board.id(12))).status, 409, 'done');

    const unsure = await startBoard(
        t,
        { items: [boardIssue(12, 'Queued')], t3: { fail: 'garbage' } },
        false,
        false,
        startableEnv(t),
    );

    await until(unsure, (d) => d.items.length === 1);
    assert.equal((await startItem(unsure, unsure.id(12))).status, 502);
    assert.equal((await abandon(unsure, unsure.id(12))).status, 409, 'uncertain');
    assert.deepEqual([...(await writes(board)), ...(await writes(unsure))], []);
});

test('a local build whose ticket and unmerged PR closed explains both, offers no Clear, stays on Cancel and goes to Archive on Abandon', async (t) => {
    const board = await startBoard(
        t,
        {
            items: [boardIssue(12, 'In progress')],
            builds: [{ number: 12, repository: { nameWithOwner: 'maddec01/lar-factory' } }],
            prs: { 'https://github.com/maddec01/lar-factory/pull/40': 'CLOSED' },
            ticketObservations: { 'maddec01/lar-factory#12': { state: 'CLOSED', assignees: [] } },
        },
        false,
        true,
    );
    const id = board.id(12);
    const data = await changeRecords(
        board,
        (records) => {
            let record = records.setPullRequest(id, records.read(id).revision, 'maddec01/lar-factory#40');

            record = records.addThread(id, record.revision, 'build-thread', 'build');
            record = records.observe(id, record.revision, { of: 'pr', state: 'closed' });
            record = records.observe(id, record.revision, { of: 'ticket', state: 'closed' });
            records.setNeedsYouCauses(id, record.revision, [{ type: 'pr-closed' }, { type: 'ticket-closed' }]);
        },
        id,
        (item) => !!item.needsYou,
    );
    const notice = data.items.find((i) => i.id === id)!.needsYou!;

    assert.match(notice.reason, /PR maddec01\/lar-factory#40 closed without merging/);
    assert.match(notice.reason, /ticket .*closed in its provider/);
    assert.ok(notice.offers.includes('set-aside'));
    assert.ok(!(notice.offers as string[]).includes('clear'));

    // Opening the confirmation only inspects, and Cancel sends nothing more.
    const inspected = await board.postSession({ itemId: id }, '/api/inspect-owned-cleanup');

    assert.equal(inspected.status, 200, await inspected.text());
    await providerPass(board);

    const cancelled = ((await board.board()) as BoardData).items.find((i) => i.id === id);

    assert.deepEqual(cancelled?.needsYou, notice);
    assert.equal((await abandon(board, id)).status, 200);
    assert.ok(!has((await board.board()) as BoardData, id));

    const { items } = (await (await fetch(`${board.url}/api/archive`)).json()) as { items: { id: string }[] };

    assert.ok(items.some((item) => item.id === id));
    assert.deepEqual(await writes(board), []);
});

test('combined success can be retried after the item leaves the board without closing twice', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(12, 'List')] });

    await until(board, (d) => d.items.length === 1);

    const id = board.id(12);

    for (let attempt = 0; attempt < 2; attempt++) {
        const response = await board.postSession({ itemId: id }, '/api/abandon-and-close');
        const result = await response.json();

        assert.equal(response.status, 200, JSON.stringify(result));
        assert.ok(!has(result.board, id));
    }
    assert.equal((await writes(board)).length, 1);
});
