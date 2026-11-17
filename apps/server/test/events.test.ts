import { deskItems, type BoardData } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { changeRecords, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';
import { statsDb } from './stats-db.ts';

/** An open event stream: its response and a wait for the next pushed board that passes a check. */
async function openStream(t: TestContext, board: Board) {
    const abort = new AbortController();

    t.onTestFinished(() => abort.abort());

    const response = await fetch(`${board.url}/api/events`, { signal: abort.signal });
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = '';
    const pushed: BoardData[] = [];

    async function next(check: (data: BoardData) => boolean): Promise<BoardData> {
        for (;;) {
            const found = pushed.splice(0).find(check);

            if (found) return found;

            const { value, done } = await reader.read();

            if (done) throw new Error('The stream ended');

            buffered += value;

            const events = buffered.split('\n\n');

            buffered = events.pop()!;
            for (const event of events) {
                const data = event
                    .split('\n')
                    .filter((line) => line.startsWith('data: '))
                    .map((line) => line.slice(6))
                    .join('\n');

                if (data) pushed.push(JSON.parse(data) as BoardData);
            }
        }
    }

    return { response, next };
}

const statusOf = (data: BoardData, id: string) => data.items.find((i) => i.id === id)?.status;

test('a change made through the board reaches every open stream', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(12, 'List')] });
    const first = await openStream(t, board);
    const second = await openStream(t, board);

    for (const stream of [first, second]) await stream.next((d) => statusOf(d, board.id(12)) === 'List');
    assert.equal((await board.post({ itemId: board.id(12) }, board.url, '/api/queue')).status, 200);
    for (const stream of [first, second]) await stream.next((d) => statusOf(d, board.id(12)) === 'Queued');
});

test('the stream refuses a foreign Host', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(1, 'List')] });
    // fetch can't set Host.
    const req = request(`${board.url}/api/events`, { headers: { Host: 'evil.example' } });

    req.end();

    const [res] = (await once(req, 'response')) as [IncomingMessage];

    res.resume();
    assert.equal(res.statusCode, 421);
});

test('an answered T3 question leaves the desk while the tracker read is still held', { timeout: 30_000 }, async (t) => {
    const db = statsDb(t, [{ id: 'owner', turns: [{ id: 'turn', startedAt: new Date().toISOString() }] }]);
    const options = {
        items: [boardIssue(12, 'Shaping')],
        threads: { 'maddec01/lar-factory#12': ['owner'] },
    };
    const board = await startBoard(t, options, false, true, { T3_STATE_DB: db });

    await until(board, (data) => data.firstRead.settled);

    const id = board.id(12);

    await changeRecords(
        board,
        (records) => {
            records.waitForUser(id, records.read(id).revision, 'Which greeting?');
        },
        id,
        (item) => !!item.needsYou,
    );
    writeFileSync(db + '.requests.json', JSON.stringify([{ turnId: 'turn', createdAt: new Date().toISOString() }]));
    await until(board, (data) => {
        const threads = data.items.find((item) => item.id === id)?.threads;

        return Array.isArray(threads) && threads[0]?.pendingRequest?.id === 'request-0';
    });

    const release = join(board.dataDir, 'release-read');

    t.onTestFinished(() => writeFileSync(release, 'release'));
    await board.update({ ...options, readHold: release });
    await board.untilCalled((args) => args[0] === 'read-held');
    writeFileSync(db + '.requests.json', '[]');

    const answered = await until(board, (data) => {
        const item = data.items.find((item) => item.id === id);

        return item?.status === 'Shaping' && !item.needsYou && !deskItems(data, false).some((wait) => wait.id === id);
    });

    const threads = answered.items.find((item) => item.id === id)?.threads;

    assert.ok(Array.isArray(threads));
    assert.equal(threads[0]?.pendingRequest, undefined);
    writeFileSync(release, 'release');
});
