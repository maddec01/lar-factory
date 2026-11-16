import type { BoardData } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { startBoard } from './server-support.ts';
import type { Board } from './server-support.ts';

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
