import type { BoardData, ItemStats } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import { onboarded, readsRepositoryConfig, startBoard, until } from './server-support.ts';
import { assistant, claudeHome, statsDb, t3Settings } from './stats-db.ts';

const draft = {
    createIssue: false,
    repo: 'maddec01/lar-factory',
    kind: 'feature',
    title: 'Capture an item',
    description: '',
};

test('writes reject foreign and missing origins before touching GitHub', async (t) => {
    const board = await startBoard(t);

    for (const origin of ['https://evil.example', 'null', '']) {
        const response = await board.post({}, origin);

        assert.equal(response.status, 403);
    }

    const calls = await board.calls();
    // Reads and the startup gh probe touch nothing; the startup read's offers look for open PRs.
    const writes = calls.filter(
        (args) =>
            !(args[0] === 'api' && args[1] === 'graphql') &&
            !(args[0] === 'api' && args[1] === '-i') &&
            args[0] !== '--version' &&
            args[0] !== 'auth' &&
            !readsRepositoryConfig(args) &&
            !args[1]?.includes('/contents/') &&
            !(args[0] === 'pr' && args[1] === 'list'),
    );

    assert.equal(writes.length, 0);
});

test('a completed submission is immediately visible and duplicate delivery reuses it', async (t) => {
    const board = await startBoard(t);

    await onboarded(board);

    const initial = await board.board();
    const body = { session: initial.capture.session, requestId: randomUUID(), draft };
    const responses = await Promise.all([board.post(body), board.post(body)]);
    const result = await responses[0]!.json();

    assert.equal(responses[0]!.status, 200);
    assert.equal(responses[1]!.status, 200);
    assert.equal(result.item.status, 'List');
    assert.equal(result.board.items[0].title, 'Capture an item');
    assert.equal((await board.board()).items[0].title, 'Capture an item');
    assert.equal((await board.post(body)).status, 200, 'lost HTTP response can be delivered again');
    assert.equal(
        (await board.board()).items.filter((i: { title: string }) => i.title === 'Capture an item').length,
        1,
        'one work record',
    );

    const calls = await board.calls();

    assert.equal(calls.filter((args) => args[0] === 'api' && args[1] === '--method').length, 0, 'no ticket is created');
});

const rawBuild = (number: number, status: string) => boardIssue(number, status, undefined, ['build']);

test('a record shared with an unread thread of another item shows provisionally, then falls, and never reaches a PR block', async (t) => {
    const home = claudeHome(t, {
        'session-b': { main: [assistant('shared', 0, 0, 0, 1000)] },
        'session-a': { main: [assistant('shared', 0, 0, 0, 1000), assistant('own', 0, 0, 0, 7)] },
    });
    const thread = (id: string, createdAt: string, read?: 'never') => ({
        id,
        ...(read && { read }),
        sessions: [{ session: `session-${id}`, instance: 'claudeAgent_personal', createdAt }],
        turns: [{ id: `turn-${id}`, startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' }],
    });
    const a = thread('a', '2026-10-20T09:10:00Z');
    const b = (read?: 'never') => thread('b', '2026-10-20T09:00:00Z', read);
    const db = statsDb(t, [a, b('never')]);
    const raw = rawBuild(12, 'Review');
    const open = {
        number: 40,
        url: 'https://github.com/maddec01/lar-factory/pull/40',
        state: 'OPEN',
        isDraft: false,
        body: 'PR 40',
    };
    const board = await startBoard(
        t,
        {
            threads: { 'maddec01/lar-factory#12': ['a'], 'maddec01/lar-factory#13': ['b'] },
            items: [
                { ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: [open] } } },
                boardIssue(13, 'Review'),
            ],
        },
        false,
        true,
        { T3_STATE_DB: db, T3_SETTINGS: t3Settings(t, { claudeAgent_personal: home }) },
    );
    const item = (data: BoardData, number: number) => data.items.find((i) => i.number === number);
    const inflated = await until(board, (d) => typeof item(d, 12)?.stats === 'object');

    assert.deepEqual(item(inflated, 12)?.stats, {
        agentMs: 30 * 60_000,
        wallMs: 30 * 60_000,
        tokens: 1007,
        provisional: true,
    });
    assert.equal(item(inflated, 13)?.usageState, 'loading');
    assert.equal(item(inflated, 13)?.stats, undefined, 'a family with a thread never read shows no figures');

    const reads = (args: string[]) => args[0] === 'api' && args[1] === 'graphql';

    // Two more reads give the board its chance to write a block.
    await board.untilCalled(reads, (await board.calls()).filter(reads).length + 2);

    const edits = async () => (await board.calls()).filter((args) => args[2] === 'PATCH');

    assert.deepEqual(await edits(), [], 'no provisional figure reaches a PR block');
    writeFileSync(`${db}.execution.json`, JSON.stringify([a, b()]));

    const settled = await until(
        board,
        (d) => !(item(d, 12)?.stats as ItemStats | undefined)?.provisional && item(d, 13)?.usageState === 'current',
    );

    assert.deepEqual(
        item(settled, 12)?.stats,
        { agentMs: 30 * 60_000, wallMs: 30 * 60_000, tokens: 7 },
        'the inflated figure was never retained',
    );
    assert.equal((item(settled, 13)!.stats as ItemStats).tokens, 1000);
    await board.untilLogged('updated item stats in https://github.com/maddec01/lar-factory/pull/40');
    assert.ok((await edits()).every((args) => !String(args[5]).includes('1,007') && !String(args[5]).includes('1.0K')));
    assert.ok(String((await edits())[0]![5]).includes('"tokens":7'));
});

test('a live board records its port for status.sh and removes the record on exit; a sample board records nothing', async (t) => {
    const home = mkdtempSync(join(tmpdir(), 'lar-records-home-'));

    t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));

    const records = join(home, 'Library/Application Support/Lar Factory/boards');
    const sample = await startBoard(t, {}, true, false, { HOME: home });
    const board = await startBoard(t, {}, false, false, { HOME: home });

    assert.deepEqual(readdirSync(records), [`${board.pid}.json`]);
    assert.deepEqual(JSON.parse(readFileSync(join(records, `${board.pid}.json`), 'utf8')), {
        port: Number(new URL(board.url).port),
    });
    await sample.stop();
    await board.stop();
    assert.deepEqual(readdirSync(records), []);
});
