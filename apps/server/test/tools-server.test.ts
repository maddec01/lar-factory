import type { BoardData, ToolCheck } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

const recheck = (board: Board) => board.post({}, board.url, '/api/recheck');

/** Each check's result, keeping a failed check whole; a passing check's version depends on the machine. */
const results = (tools: BoardData['tools']) =>
    tools &&
    Object.fromEntries(
        Object.entries(tools).map(([name, check]: [string, ToolCheck]) => [name, check.result === 'ok' ? 'ok' : check]),
    );
const allOk = { gh: 'ok', t3: 'ok', git: 'ok', jq: 'ok', curl: 'ok' };
const ghLoggedOut = { ...allOk, gh: { result: 'logged-out', version: '2.96.0', fix: 'gh auth login' } };

/** Whether every check the first lookup asked for has landed. */
const landed = (data: BoardData) =>
    (['t3', 'git', 'jq', 'curl'] as const).every((name) => data.tools?.[name]) &&
    !data.toolProgress?.checking.includes('gh') &&
    !data.toolProgress?.checking.includes('az');
const checked = (board: Board) => until(board, landed);

/** The board data once the first read has finished, or failed, and every check has landed. */
const afterRead = (board: Board) => until(board, (d) => Boolean(d.fetchedAt || d.error) && landed(d));

test('a logged-out gh shows its notice and reads nothing until Recheck finds it logged in', async (t) => {
    const board = await startBoard(t, { ghAuth: 'logged-out' });
    const data = await checked(board);

    assert.deepEqual(results(data.tools), ghLoggedOut);
    assert.equal(data.error, null);
    assert.equal((await board.calls()).filter((args) => args[1] === 'graphql').length, 0);
    await board.update({});
    assert.deepEqual(results((await (await recheck(board)).json()).board.tools), allOk);
    assert.ok((await afterRead(board)).fetchedAt, 'the board reads GitHub once gh works');
});
