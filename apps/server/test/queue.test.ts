import type { BoardData, Status } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { openWorkRecords, workRecordsPath } from '@lar-factory/work-records';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { startableEnv, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

const statusOf = (data: BoardData, id: string) => data.items.find((i) => i.id === id)?.status;
const queue = (board: Board, itemId: string, origin = board.url) => board.post({ itemId }, origin, '/api/queue');
const backToList = (board: Board, itemId: string, origin = board.url) =>
    board.post({ itemId }, origin, '/api/back-to-list');
/** The gh calls that changed an issue: a move writes none. */
const issueEdits = async (board: Board) =>
    (await board.calls()).filter((args) => args[0] === 'issue' && args[1] === 'edit');

/** The Status the board's work-record database holds for `workId`, read as a thread would. */
async function recordedStatus(board: Board, workId: string): Promise<Status> {
    const records = await openWorkRecords(workRecordsPath(board.dataDir));

    try {
        return records.read(workId).status;
    } finally {
        records.close();
    }
}

test('Queue moves the work record to Queued, shows it at once and writes nothing to GitHub', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(12, 'List')] });

    await until(board, (d) => d.items.length === 1);

    const id = board.id(12);
    const response = await queue(board, id);

    assert.equal(response.status, 200);
    assert.equal(statusOf((await response.json()).board, id), 'Queued');
    assert.equal(statusOf(await board.board(), id), 'Queued');
    assert.equal(await recordedStatus(board, id), 'Queued');
    assert.deepEqual(await issueEdits(board), []);
});

test("refreshes keep the record's Queued though GitHub's labels still say List", async (t) => {
    const board = await startBoard(t, { items: [boardIssue(12, 'List')] }, false, true);

    await until(board, (d) => d.items.length === 1);

    const id = board.id(12);

    assert.equal((await queue(board, id)).status, 200);

    const reads = async () =>
        (await board.calls()).filter((args) => args[1] === 'graphql' && args.some((a) => a.includes('states: [OPEN]')))
            .length;
    const target = (await reads()) + 4;

    while ((await reads()) < target) await new Promise((r) => setTimeout(r, 20));

    assert.equal(statusOf(await board.board(), id), 'Queued');
});

test('a move on a record a thread changed since the board read it is refused, and the board shows the record as it is', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(12, 'List')] });

    // Let startup's provider observation publish its revision before deliberately making the board stale.
    await until(board, (d) => d.firstRead.settled && d.items.length === 1 && d.items[0]!.revision > 1);

    const id = board.id(12);
    const records = await openWorkRecords(workRecordsPath(board.dataDir));

    try {
        records.update(id, records.read(id).revision, { kind: 'bug' });
    } finally {
        records.close();
    }

    const response = await queue(board, id);

    assert.equal(response.status, 409);

    const body = (await response.json()) as { error: string; board: BoardData };

    assert.match(body.error, /read it again/);
    assert.equal(body.board.items.find((i) => i.id === id)?.kind, 'bug');
    assert.equal(await recordedStatus(board, id), 'List');
});

test('Queue and Back to List reject requests from other pages and sample mode', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(12, 'List')] });

    await until(board, (d) => d.items.length === 1);
    for (const origin of ['https://evil.example', 'null', '']) {
        assert.equal((await queue(board, board.id(12), origin)).status, 403);
        assert.equal((await backToList(board, board.id(12), origin)).status, 403);
    }
    assert.equal(await recordedStatus(board, board.id(12)), 'List');

    const sample = await startBoard(t, {}, true);

    assert.equal((await queue(sample, 'I_sample01')).status, 403);

    const response = await backToList(sample, 'I_sample01');

    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'Moving items back to List is disabled in sample mode.');
    assert.equal((await sample.calls()).length, 0);
});

const startItem = (board: Board, itemId: string) => board.postSession({ itemId }, '/api/start');

test('Back to List is refused while a Start is in flight, uncertain or done for the item', async (t) => {
    const refused = 'Start is running or has run for this item. Check its T3 thread before moving it back to List.';
    const board = await startBoard(
        t,
        { items: [boardIssue(12, 'Queued')], t3: { delay: 300 } },
        false,
        false,
        startableEnv(t),
    );

    await until(board, (d) => d.items.length === 1);

    const id = board.id(12);
    const starting = startItem(board, id);

    await new Promise((r) => setTimeout(r, 100));

    const inFlight = await backToList(board, id);

    assert.equal(inFlight.status, 409);
    assert.equal((await inFlight.json()).error, refused);
    assert.equal((await starting).status, 200);
    assert.equal((await backToList(board, id)).status, 409, 'done');

    const unsure = await startBoard(
        t,
        { items: [boardIssue(12, 'Queued')], t3: { fail: 'killed' } },
        false,
        false,
        startableEnv(t),
    );

    await until(unsure, (d) => d.items.length === 1);
    assert.equal((await startItem(unsure, unsure.id(12))).status, 502);
    assert.equal((await backToList(unsure, unsure.id(12))).status, 409, 'uncertain');
    assert.equal(await recordedStatus(board, id), 'Shaping');
    assert.equal(await recordedStatus(unsure, unsure.id(12)), 'Queued');
});
