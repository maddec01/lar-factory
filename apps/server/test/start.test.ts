import type { BoardData } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { checkouts } from './repo-support.ts';
import { shapePrompt, DEFAULT_SELECTION, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';
import { projectsDb } from './stats-db.ts';
import type { FixtureProject } from './stats-db.ts';

/** The work message for issue 12's work record on `board`. */
const message = (board: Board) => shapePrompt(board, '#12 Issue 12', board.id(12));

/** A temporary home with git checkouts of the given origins under ~/Developer/lar. */
function home(t: TestContext, origins: Record<string, string | null>): string {
    const dir = mkdtempSync(join(tmpdir(), 'lar-start-home-'));

    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    checkouts(dir, origins);

    return dir;
}

/** A board whose home has the checkouts, and whose T3 database is the one db(home) returns. */
async function boardIn(
    t: TestContext,
    items: object[],
    origins: Record<string, string | null>,
    db: (home: string) => string,
    options: object = {},
) {
    const dir = home(t, origins);
    const board = await startBoard(t, { items, ...options }, false, false, { HOME: dir, T3_STATE_DB: db(dir) });

    await until(board, (d) => d.items.length === items.length);

    return { board, home: dir };
}

/** The live lar project holds every checkout but is no checkout itself, so only origins tell repositories apart. */
const PROJECTS = (dir: string): FixtureProject[] => [
    { id: 'project-lar', root: `${dir}/Developer/lar` },
    { id: 'project-factory', root: `${dir}/Developer/lar/lar-factory/` },
    { id: 'project-server-old', root: `${dir}/Developer/lar/api`, deletedAt: '2026-10-01T00:00:00Z' },
    { id: 'project-server', root: '~/Developer/lar/api' },
];
const ORIGINS = {
    'lar-factory': 'git@github.com:maddec01/lar-factory.git',
    api: 'https://github.com/ACME/Api',
};

async function factoryBoard(t: TestContext, items: object[], options: object = {}) {
    return (await boardIn(t, items, ORIGINS, (dir) => projectsDb(t, PROJECTS(dir)), options)).board;
}

const start = (board: Board, itemId: string) => board.postSession({ itemId }, '/api/start');

test("Start begins one lar-shape thread in the card's repository project and leaves the Status alone", async (t) => {
    const board = await factoryBoard(t, [boardIssue(12, 'Queued'), boardIssue(30, 'Queued', 'acme/api')]);
    const response = await start(board, board.id(12));

    assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
    assert.deepEqual((await response.json()).thread, { threadId: 'thread-1', title: 'Shaping #12 Issue 12' });
    assert.equal((await start(board, board.id(30, 'acme/api'))).status, 200);
    assert.deepEqual(await board.t3Calls(), [
        ['launch', 'project-factory', await message(board), DEFAULT_SELECTION, { type: 'root' }, 'full-access'],
        [
            'launch',
            'project-server',
            await shapePrompt(board, '#30 Issue 30', board.id(30, 'acme/api')),
            DEFAULT_SELECTION,
            { type: 'root' },
            'full-access',
        ],
    ]);
    assert.equal((await board.calls()).filter((args) => args[1] === 'item-edit').length, 0);
});

const NO_PROJECT = 'No T3 project is a checkout of maddec01/lar-factory; add the checkout in T3 Code';

test("Start refuses a folder that is another repository's checkout with a hint and runs no t3", async (t) => {
    const { board } = await boardIn(
        t,
        [boardIssue(12, 'Queued')],
        { 'lar-factory': 'https://github.com/acme/api.git' },
        (dir) => projectsDb(t, PROJECTS(dir)),
    );
    const response = await start(board, board.id(12));

    assert.equal(response.status, 409, 'a refusal is not a t3 failure');

    const answer = await response.json();

    assert.equal(answer.error, NO_PROJECT);
    assert.equal(answer.uncertain, undefined, 'a refused Start can be pressed again');
    assert.deepEqual(await board.t3Calls(), []);
});

test('a double press, a retry or another page starts no second thread for the item', async (t) => {
    const board = await factoryBoard(t, [boardIssue(12, 'Queued'), boardIssue(13, 'Queued')], { t3: { delay: 100 } });
    const responses = await Promise.all([start(board, board.id(12)), start(board, board.id(12))]);

    assert.deepEqual(
        responses.map((r) => r.status),
        [200, 200],
    );

    const duplicate = await start(board, board.id(12));

    assert.equal(duplicate.status, 409);
    assert.match((await duplicate.json()).error, /already owns.*shaping.*Open thread/);

    const thread = { threadId: 'thread-1', title: 'Shaping #12 Issue 12' };

    assert.deepEqual(
        ((await board.board()) as BoardData).started,
        { [board.id(12)]: thread },
        'a reloaded page sees the thread',
    );
    assert.equal((await start(board, board.id(13))).status, 200, 'another item starts its own thread');
    assert.equal((await board.t3Calls()).length, 2);
});

test('an unconfirmed start (killed) is never retried as a new thread', async (t) => {
    const board = await factoryBoard(t, [boardIssue(12, 'Queued')], { t3: { fail: 'killed' } });
    const first = await start(board, board.id(12));

    assert.equal(first.status, 202);
    assert.equal((await first.json()).uncertain, true);
    await board.update({ items: [boardIssue(12, 'Queued')] });
    assert.equal((await (await start(board, board.id(12))).json()).uncertain, true);
    assert.equal((await board.t3Calls()).filter((args) => args[0] === 'launch').length, 1);
});
