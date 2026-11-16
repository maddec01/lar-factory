import type { BoardData } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

const abandon = (board: Board, itemId: string) => board.postSession({ itemId }, '/api/abandon');
const closeTicket = (board: Board, itemId: string) => board.postSession({ itemId }, '/api/close-ticket');

const has = (data: BoardData, id: string) => data.items.some((i) => i.id === id);
const writes = async (board: Board) =>
    (await board.calls()).filter((args) => args[1] === 'close' || args[1] === 'item-delete');

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
