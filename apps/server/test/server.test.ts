import { itemTotal } from '@lar-factory/shared';
import type { BoardData, Item, ItemStats } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import { changeRecords, onboarded, readsRepositoryConfig, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';
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
    const board = await startBoard(t, { readDelay: 700 });

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
    await new Promise((r) => setTimeout(r, 850));
    assert.equal(
        (await board.board()).items[0].title,
        'Capture an item',
        'older refresh cannot erase the created item',
    );
    assert.equal((await board.post(body)).status, 200, 'lost HTTP response can be delivered again');
    assert.equal(
        (await board.board()).items.filter((i: { title: string }) => i.title === 'Capture an item').length,
        1,
        'one work record',
    );

    const calls = await board.calls();

    assert.equal(calls.filter((args) => args[0] === 'api' && args[1] === '--method').length, 0, 'no ticket is created');
});

test('HTTP validation rejects malformed, oversized and mismatched drafts without a GitHub write', async (t) => {
    const board = await startBoard(t);
    const initial = await board.board();
    const body = { session: initial.capture.session, requestId: randomUUID(), draft };

    for (const changed of [{ title: '  ' }, { repo: 'other/repo' }, { kind: 'concept' }, { description: 42 }]) {
        const response = await board.post({ ...body, draft: { ...draft, ...changed } });

        assert.equal(response.status, 422);
        assert.equal(typeof (await response.json()).error, 'string');
    }
    assert.equal(
        (await board.post({ ...body, session: 'old-board-session' })).status,
        200,
        'durable submissions can recover across board sessions',
    );
    assert.equal((await board.post({ ...body, draft: { ...draft, description: 'x'.repeat(100_001) } })).status, 413);
    assert.equal(
        (
            await fetch(`${board.url}/api/items`, {
                method: 'POST',
                headers: { Origin: board.url, 'Content-Type': 'application/json' },
                body: '{',
            })
        ).status,
        400,
    );
    assert.equal(
        (await fetch(`${board.url}/api/items`, { method: 'POST', headers: { Origin: board.url }, body: '{}' })).status,
        415,
    );
    assert.equal((await board.calls()).filter((args) => args[0] === 'api' && args[1] === '--method').length, 0);
});

test('the page holds its first paint for its one script, served from the board, so it never shows empty', async (t) => {
    const board = await startBoard(t, {}, true);
    const response = await fetch(`${board.url}/`);

    assert.match(response.headers.get('content-security-policy') ?? '', /script-src 'self';/);

    const scripts = [...(await response.text()).matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag);

    assert.equal(scripts.length, 2);
    assert.match(
        scripts[0]!,
        /^<script type="module" blocking="render" crossorigin src="\/assets\/index-[\w-]+\.js">$/,
    );
    assert.equal(scripts[1], '<script id="board-data" type="application/json">');
});

test('sample mode never writes through the local GitHub login', async (t) => {
    const board = await startBoard(t, {}, true);

    assert.equal((await board.post({})).status, 400);
    assert.equal((await board.board()).capture.enabled, true);
    assert.equal((await board.calls()).length, 0);
});

test('a created item stays on the board as recorded work while GitHub does not list its issue', async (t) => {
    const board = await startBoard(t, { readDelay: 800, delayedRepos: ['maddec01/lar-factory'] }, false, true);

    await onboarded(board);

    const initial = await board.board();
    const response = await board.post({ session: initial.capture.session, requestId: randomUUID(), draft });
    const [created] = (await response.json()).board.items as Item[];

    assert.equal(created?.title, draft.title, 'creation appears immediately');

    // GitHub keeps returning no issue, as when its index lags; three reads later the work record still holds it.
    const reads = async () => (await board.calls()).filter((args) => args[1] === 'graphql').length;
    const target = (await reads()) + 3;

    while ((await reads()) < target) await new Promise((r) => setTimeout(r, 50));

    assert.deepEqual(
        (await board.board()).items.map((i: Item) => i.id),
        [created!.id],
    );
});

const rawBuild = (number: number, status: string) => boardIssue(number, status, undefined, ['build']);

/** The board's items once its first read lands. */
const readItems = async (board: Board): Promise<Item[]> => (await until(board, (d) => d.items.length > 0)).items;
/** The items once the board shows settled live stats, whose figures are provisional until a stats read after the first read. */
const readLiveStats = async (board: Board): Promise<Item[]> =>
    (
        await until(board, (d) =>
            d.items.some((i) => typeof i.stats === 'object' && !i.stats.frozen && !i.stats.provisional),
        )
    ).items;

test('one failed thread fails only the item whose family holds it: its known figures stay, and a success brings it back', async (t) => {
    const thread = (id: string, read?: 'failed') => ({
        id,
        ...(read && { read }),
        turns: [{ id: `turn-${id}`, startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' }],
    });
    const db = statsDb(t, [thread('a'), thread('b')]);
    const board = await startBoard(
        t,
        {
            threads: { 'maddec01/lar-factory#12': ['a'], 'maddec01/lar-factory#13': ['b'] },
            items: [boardIssue(12, 'Review'), boardIssue(13, 'Review'), boardIssue(14, 'Review')],
        },
        false,
        true,
        { T3_STATE_DB: db },
    );
    const item = (data: BoardData, number: number) => data.items.find((i) => i.number === number);
    const settled = (stats: Item['stats']) => typeof stats === 'object' && !stats.provisional;
    const known = await until(board, (d) => settled(item(d, 12)?.stats) && settled(item(d, 13)?.stats));

    assert.equal(item(known, 12)?.usageState, 'current');
    assert.equal(item(known, 14)?.usageState, undefined, 'work with no thread has no usage to wait for');
    writeFileSync(`${db}.execution.json`, JSON.stringify([thread('a', 'failed'), thread('b')]));

    const failed = await until(board, (d) => item(d, 12)?.usageState === 'failed');

    assert.deepEqual(item(failed, 12)?.stats, item(known, 12)?.stats);
    assert.equal(item(failed, 13)?.usageState, 'current');
    assert.equal(failed.usageRead?.readable, true);
    // The thread refreshes between usage reads rewrite the items, every 100 ms here.
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(item(await board.board(), 12)?.usageState, 'failed');
    writeFileSync(`${db}.execution.json`, JSON.stringify([thread('a'), thread('b')]));
    await until(board, (d) => item(d, 12)?.usageState === 'current');
});

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
    await new Promise((r) => setTimeout(r, 500));

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

test('a provisional figure never raises merged figures, and the first read past it does', async (t) => {
    const home = claudeHome(t, {
        'session-b': { main: [assistant('shared', 0, 0, 0, 1000)] },
        'session-a': { main: [assistant('shared', 0, 0, 0, 1000), assistant('own', 0, 0, 0, 7)] },
    });
    const thread = (id: string, createdAt: string, read?: 'never') => ({
        id,
        ...(read && { read }),
        sessions: [{ session: `session-${id}`, instance: 'claudeAgent_personal', createdAt }],
        turns: [{ id: `turn-${id}`, startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:01:00Z' }],
    });
    const a = thread('a', '2026-10-20T09:10:00Z');
    const db = statsDb(t, [a, thread('b', '2026-10-20T09:00:00Z', 'never')]);
    const raw = rawBuild(12, 'Done');
    const block =
        '<!-- lar-stats -->\n**Item stats** (kept current by the lar board): Σ 30m · wall 30m · 5\n<!-- lar-stats-data {"agentMs":1800000,"wallMs":1800000,"tokens":5} -->\n<!-- /lar-stats -->';
    const merged = {
        number: 40,
        url: 'https://github.com/maddec01/lar-factory/pull/40',
        state: 'MERGED',
        mergedAt: '2026-10-20T10:00:00Z',
        isDraft: false,
        body: block,
    };
    const board = await startBoard(
        t,
        {
            threads: { 'maddec01/lar-factory#12': ['a'], 'maddec01/lar-factory#13': ['b'] },
            items: [
                { ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: [merged] } } },
                boardIssue(13, 'Review'),
            ],
        },
        false,
        true,
        { T3_STATE_DB: db, T3_SETTINGS: t3Settings(t, { claudeAgent_personal: home }) },
    );
    const stats = (data: BoardData) => data.items.find((i) => i.number === 12)?.stats as ItemStats | undefined;

    await until(board, (d) => d.items.find((i) => i.number === 12)?.usageState === 'current');
    await new Promise((r) => setTimeout(r, 300));

    const held = await board.board();

    assert.equal(stats(held)?.tokens, 5);
    assert.equal(stats(held)?.frozen, true);
    writeFileSync(`${db}.execution.json`, JSON.stringify([a, thread('b', '2026-10-20T09:00:00Z')]));
    assert.equal(stats(await until(board, (d) => stats(d)?.tokens !== 5))?.tokens, 7);
});

test("a build's slices show their records' progress, and its build sub-issue stays a board item", async (t) => {
    const repository = { nameWithOwner: 'maddec01/lar-factory' };
    const ref = (number: number) => ({
        number,
        title: `Issue ${number}`,
        url: `https://github.com/maddec01/lar-factory/issues/${number}`,
        state: 'OPEN',
        stateReason: null,
        repository,
    });
    const parent = rawBuild(13, 'In progress');
    const items = [
        { ...parent, content: { ...parent.content, subIssues: { nodes: [ref(12), ref(15), ref(16)] } } },
        rawBuild(12, 'In progress'),
        boardIssue(15, 'In progress'),
    ];
    const board = await startBoard(t, {
        items,
        builds: [{ number: 12, repository }],
        active: [
            { number: 15, repository },
            { number: 16, repository },
        ],
        blocked: [{ number: 16, repository }],
    });
    const read = await readItems(board);

    assert.deepEqual(
        read.map((i) => i.number).sort((a, b) => a - b),
        [12, 13],
        'the build sub-issue stays a board item; the slice does not',
    );

    const built = read.find((i) => i.number === 13);

    assert.deepEqual(
        built?.slices.map((s) => [s.number, s.progress]),
        [
            [15, 'waiting'],
            [16, 'blocked'],
        ],
    );
});

test("each refresh attaches the threads each work record holds and T3's environment id, and leaves them out without T3's files", async (t) => {
    // The thread's first message names #13, which no longer associates it.
    const db = statsDb(t, [
        {
            id: 'build',
            title: 'Build: owner accounts',
            messages: ['Build maddec01/lar-factory#13'],
            turns: [{ id: 't', startedAt: '2026-10-20T09:00:00Z' }],
        },
    ]);
    const environment = join(mkdtempSync(join(tmpdir(), 'lar-t3-env-')), 'environment-id');

    t.onTestFinished(() => rmSync(join(environment, '..'), { recursive: true, force: true }));
    writeFileSync(environment, 'env-1\n');

    const board = await startBoard(
        t,
        {
            items: [boardIssue(12, 'In progress'), boardIssue(13, 'Review')],
            threads: { 'maddec01/lar-factory#12': ['build'] },
        },
        false,
        false,
        { T3_STATE_DB: db, T3_ENVIRONMENT_ID: environment },
    );
    const data = await until(board, (d) => d.items.length > 0 && d.firstRead?.settled === true);

    assert.equal(data.t3EnvironmentId, 'env-1');
    assert.deepEqual(data.items.find((i) => i.number === 12)?.threads, [
        {
            id: 'build',
            title: 'Build: owner accounts',
            state: 'running',
            currentRunning: true,
            updated: '2026-10-20T09:00:00.000Z',
            purpose: 'shape',
            activity: { available: false },
        },
    ]);
    assert.equal(data.items.find((i) => i.number === 13)?.threads, undefined);

    const without = await until(
        await startBoard(t, { items: [boardIssue(12, 'In progress')] }),
        (d) => d.items.length > 0,
    );

    assert.equal(without.t3EnvironmentId, undefined);
    assert.equal(without.items[0]?.threads, undefined);
});

test('refreshes keep a stats block in open linked PRs, edit only when it changes, and never in sample mode', async (t) => {
    const db = statsDb(t, [
        {
            id: 'build',
            messages: ['Build maddec01/lar-factory#12'],
            turns: [{ id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' }],
        },
    ]);
    const pr = (number: number, state: string) => ({
        number,
        url: `https://github.com/maddec01/lar-factory/pull/${number}`,
        state,
        isDraft: false,
        body: `PR ${number}`,
    });
    const withPrs = (number: number, prs: object[]) => {
        const raw = rawBuild(number, 'Review');

        return { ...raw, content: { ...raw.content, closedByPullRequestsReferences: { nodes: prs } } };
    };
    const items = [withPrs(12, [pr(40, 'OPEN'), pr(41, 'MERGED')]), withPrs(13, [pr(42, 'OPEN')])];
    // A slow live-body read must finish before checking the edit and its next authoritative read.
    const board = await startBoard(
        t,
        { threads: { 'maddec01/lar-factory#12': ['build'] }, items, prReadDelay: 2500 },
        false,
        true,
        { T3_STATE_DB: db },
    );
    const edits = async () => (await board.calls()).filter((args) => args[2] === 'PATCH');

    await board.untilLogged('updated item stats in https://github.com/maddec01/lar-factory/pull/40');
    await until(
        board,
        (data) =>
            data.items
                .find((item) => item.number === 12)
                ?.linkedPrs.some((pr) => pr.body?.includes('<!-- lar-stats-data ')) === true,
    );

    const made = await edits();

    assert.equal(made.length, 1, 'later refreshes see the block is current and leave the PR alone');
    assert.equal(
        made[0]![3],
        'repos/maddec01/lar-factory/pulls/40',
        'merged PRs and items without stats are left alone',
    );
    assert.equal(
        made[0]![5],
        'body=PR 40\n\n<!-- lar-stats -->\n**Item stats** (kept current by the lar board): Σ 30m · wall 30m · 0\n<!-- lar-stats-data {"agentMs":1800000,"wallMs":1800000,"tokens":0} -->\n<!-- /lar-stats -->',
    );

    const failing = await startBoard(
        t,
        { threads: { 'maddec01/lar-factory#12': ['build'] }, items, fail: 'pr-edit' },
        false,
        false,
        { T3_STATE_DB: db },
    );

    assert.equal((await readItems(failing)).length, 2, 'a failed edit leaves the board working');

    const sample = await startBoard(t, {}, true, true, { T3_STATE_DB: db });

    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(
        (await sample.calls()).filter((args) => args[2] === 'PATCH'),
        [],
    );
});

test('a merged item retains its PR figures and adds fresh stats without lowering known work', async (t) => {
    const turns = [{ id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' }];
    const db = statsDb(t, [
        { id: 'a', messages: ['Build maddec01/lar-factory#12'], turns },
        { id: 'b', messages: ['Build maddec01/lar-factory#13'], turns: [{ ...turns[0]!, id: 'u' }] },
    ]);
    const block =
        '<!-- lar-stats -->\n**Item stats** (kept current by the lar board): agent time 2h 15m · 12.4M tokens · $41\n<!-- /lar-stats -->';
    const merged = (number: number, prNumber: number, body: string) => {
        const raw = rawBuild(number, 'Done');

        return {
            ...raw,
            content: {
                ...raw.content,
                closedByPullRequestsReferences: {
                    nodes: [
                        {
                            number: prNumber,
                            url: `https://github.com/maddec01/lar-factory/pull/${prNumber}`,
                            state: 'MERGED',
                            isDraft: false,
                            body,
                        },
                    ],
                },
            },
        };
    };
    const board = await startBoard(
        t,
        {
            threads: { 'maddec01/lar-factory#12': ['a'], 'maddec01/lar-factory#13': ['b'] },
            items: [merged(12, 40, `PR 40\n\n${block}`), merged(13, 41, 'PR 41'), merged(14, 42, `PR 42\n\n${block}`)],
        },
        false,
        true,
        { T3_STATE_DB: db },
    );
    const items = await readLiveStats(board);
    const frozen = { agentMs: 135 * 60_000, tokens: 12_400_000, costUsd: 41, frozen: true };

    assert.deepEqual(
        items.find((i) => i.number === 12)?.stats,
        { ...frozen, wallMs: 30 * 60_000 },
        'retain known figures and add the fresh wall time',
    );
    assert.deepEqual(
        items.find((i) => i.number === 13)?.stats,
        { agentMs: 30 * 60_000, wallMs: 30 * 60_000, tokens: 0 },
        'no block: live stats',
    );
    assert.deepEqual(items.find((i) => i.number === 14)?.stats, frozen, 'no live stats at all');
    await until(
        board,
        (d) =>
            d.items.find((i) => i.number === 12)?.linkedPrs.some((pr) => pr.body?.includes('<!-- lar-stats-data ')) ===
            true,
    );
    assert.deepEqual(
        (await board.calls()).filter((args) => args[2] === 'PATCH').map((args) => args[3]),
        ['repos/maddec01/lar-factory/pulls/40'],
        'only the PR with fresher stats gets a final block',
    );
});

test('a concept with two builds merged at different times: each build keeps its own frozen figures, the concept writes no block, its total counts all once', async (t) => {
    const turns = [{ id: 't', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' }];
    // The parent's own thread is live; the builds' threads are gone from T3 Code, as after transcript deletion.
    const db = statsDb(t, [{ id: 'p', messages: ['$lar-work maddec01/lar-factory#13'], turns }]);
    const block = (figures: string) =>
        `<!-- lar-stats -->\n**Item stats** (kept current by the lar board): ${figures}\n<!-- /lar-stats -->`;
    const pr = (number: number, mergedAt: string, body: string) => ({
        number,
        url: `https://github.com/maddec01/lar-factory/pull/${number}`,
        state: 'MERGED',
        isDraft: false,
        body,
        mergedAt,
    });
    const first = pr(40, '2026-10-18T10:00:00Z', `PR 40\n\n${block('Σ 1h 0m · wall 40m · 2M · $10')}`);
    const last = pr(41, '2026-10-20T10:00:00Z', `PR 41\n\n${block('Σ 2h 0m · wall 1h 0m · 3M · $20')}`);
    const parentRef = {
        number: 13,
        title: 'Issue 13',
        url: 'https://github.com/maddec01/lar-factory/issues/13',
        state: 'OPEN',
        repository: { nameWithOwner: 'maddec01/lar-factory' },
    };
    const build = (number: number, linked: object) => {
        const raw = rawBuild(number, 'Done');

        return {
            ...raw,
            content: {
                ...raw.content,
                state: 'CLOSED',
                closedAt: new Date(Date.now() - 60_000).toISOString(),
                updatedAt: new Date(Date.now() - 60_000).toISOString(),
                parent: parentRef,
                closedByPullRequestsReferences: { nodes: [linked] },
            },
        };
    };
    const parent = boardIssue(13, 'In progress', undefined, ['concept']);
    // The last build's PR also closes the concept.
    const items = [
        {
            ...parent,
            content: {
                ...parent.content,
                subIssuesSummary: { total: 2, completed: 2 },
                closedByPullRequestsReferences: { nodes: [last] },
            },
        },
        build(12, first),
        build(14, last),
    ];
    const check = async (board: Awaited<ReturnType<typeof startBoard>>) => {
        const read = await readLiveStats(board);
        const of = (number: number) => read.find((i) => i.number === number)!;

        assert.deepEqual(of(12).stats, {
            agentMs: 60 * 60_000,
            wallMs: 40 * 60_000,
            tokens: 2_000_000,
            costUsd: 10,
            frozen: true,
        });
        assert.deepEqual(of(14).stats, {
            agentMs: 120 * 60_000,
            wallMs: 60 * 60_000,
            tokens: 3_000_000,
            costUsd: 20,
            frozen: true,
        });
        assert.deepEqual(
            of(13).stats,
            { agentMs: 30 * 60_000, wallMs: 30 * 60_000, tokens: 0 },
            'the parent keeps live own figures',
        );
        assert.deepEqual(itemTotal(of(13), read), {
            agentMs: 210 * 60_000,
            wallMs: 130 * 60_000,
            tokens: 5_000_000,
            costUsd: 30,
        });
    };
    const board = await startBoard(t, { threads: { 'maddec01/lar-factory#13': ['p'] }, items }, false, true, {
        T3_STATE_DB: db,
    });

    await check(board);
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(
        (await board.calls()).filter((args) => args[2] === 'PATCH'),
        [],
        'merged PRs are never edited, and the parent writes no block',
    );
    await check(
        await startBoard(t, { threads: { 'maddec01/lar-factory#13': ['p'] }, items }, false, false, {
            T3_STATE_DB: db,
        }),
    );
});

test('PR edits run beside the refreshes without holding them up, and never two syncs at once', async (t) => {
    // The build's thread still runs, so its figures aren't final and a refresh soon after a sync starts no other.
    const db = statsDb(t, [
        {
            id: 'build',
            messages: ['Build maddec01/lar-factory#12'],
            turns: [{ id: 't', startedAt: '2026-10-20T09:00:00Z' }],
        },
    ]);
    const raw = rawBuild(12, 'Review');
    const items = [
        {
            ...raw,
            content: {
                ...raw.content,
                closedByPullRequestsReferences: {
                    nodes: [
                        {
                            number: 40,
                            url: 'https://github.com/maddec01/lar-factory/pull/40',
                            state: 'OPEN',
                            isDraft: false,
                            body: 'PR 40',
                        },
                    ],
                },
            },
        },
    ];
    const dir = mkdtempSync(join(tmpdir(), 'lar-pr-edit-'));

    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

    const release = join(dir, 'release');
    // Keep the edit pending until a slow refresh finishes, regardless of process scheduling.
    const board = await startBoard(
        t,
        {
            threads: { 'maddec01/lar-factory#12': ['build'] },
            items,
            prEditHold: release,
            readDelay: 1500,
            delayedRepos: ['maddec01/lar-factory'],
        },
        false,
        true,
        { T3_STATE_DB: db },
    );
    const prCalls = async () =>
        (await board.calls()).filter((args) => args[1]?.includes('/pulls/') || args[2] === 'PATCH');

    await board.untilCalled((args) => args[2] === 'PATCH');

    const first = await board.board();
    const later = await until(board, (data) => data.fetchedAt !== first.fetchedAt);

    assert.notEqual(later.fetchedAt, first.fetchedAt, 'the board refreshed while the edit was under way');
    assert.equal(later.items[0]?.linkedPrs[0]?.body, 'PR 40', 'the edit had not landed yet');
    writeFileSync(release, '');
    await board.untilLogged('updated item stats in https://github.com/maddec01/lar-factory/pull/40');
    await until(board, (data) => data.items[0]?.linkedPrs[0]?.body?.includes('<!-- lar-stats-data ') === true);
    assert.deepEqual(
        (await prCalls()).map((args) => (args[2] === 'PATCH' ? 'PATCH' : 'read')),
        ['read', 'PATCH'],
        'refreshes during the edit started no second sync',
    );
});

test("a BOARD_PORT that isn't a port exits with a log line, not a stack trace", async (t) => {
    await assert.rejects(
        startBoard(t, {}, true, false, { BOARD_PORT: 'abc' }),
        (err: Error) =>
            /BOARD_PORT=abc is not a port/.test(err.message) && !/ERR_SOCKET_BAD_PORT|\n\s+at /.test(err.message),
    );
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

test('default-status slices follow implementation activity on local refresh without available usage', async (t) => {
    const db = statsDb(t, []);
    const board = await startBoard(t, { items: [rawBuild(13, 'In progress')] }, false, true, {
        T3_STATE_DB: db,
        BOARD_READ_MS: '60000',
        FAKE_EXECUTION_STATS_UNAVAILABLE: '1',
    });
    const parent = (await readItems(board))[0]!;
    let sliceId = '';

    await changeRecords(
        board,
        (records) => {
            let slice = records.create({ title: 'Live slice', repository: parent.repo, kind: 'slice' });

            slice = records.setParent(slice.workId, slice.revision, parent.id);
            sliceId = slice.workId;
            records.addThread(slice.workId, slice.revision, 'implementation', 'implement');

            const unrelated = records.create({ title: 'Planning slice', repository: parent.repo, kind: 'slice' });
            const attached = records.setParent(unrelated.workId, unrelated.revision, parent.id);

            records.addThread(attached.workId, attached.revision, 'planner', 'shape');
        },
        parent.id,
        (item) => item.slices.length === 2,
    );

    const observe = async (threads: unknown[], expected: string, requests: unknown[] = []) => {
        writeFileSync(db + '.requests.json', JSON.stringify(requests));
        writeFileSync(db + '.execution.json', JSON.stringify(threads));

        const data = await until(
            board,
            (data) =>
                data.items.find((item) => item.id === parent.id)?.slices.find((slice) => slice.workId === sliceId)
                    ?.progress === expected,
        );

        assert.equal(
            data.items.find((item) => item.id === parent.id)!.slices.find((slice) => slice.title === 'Planning slice')!
                .progress,
            'waiting',
        );
    };
    const running = { id: 'implementation', turns: [{ id: 'turn', startedAt: '2026-11-01T08:00:00Z' }] };
    const planner = { ...running, id: 'planner' };

    await observe([running, planner], 'active');
    await observe([running, planner], 'blocked', [{ turnId: 'turn', createdAt: '2026-11-01T08:01:00Z' }]);
    for (const status of ['completed', 'failed', 'interrupted', 'cancelled']) {
        await observe(
            [
                {
                    id: 'implementation',
                    turns: [
                        { id: 'turn', startedAt: '2026-11-01T08:00:00Z', completedAt: '2026-11-01T08:02:00Z', status },
                    ],
                },
                planner,
            ],
            'waiting',
        );
    }
    await observe([planner], 'unknown');
    await observe(
        [{ id: 'implementation' }, { ...running, id: 'child', rootThreadId: 'implementation' }, planner],
        'active',
    );
    await changeRecords(
        board,
        (records) => {
            records.addThread(sliceId, records.read(sliceId).revision, 'retry', 'implement');
        },
        parent.id,
        (item) => item.slices.find((slice) => slice.workId === sliceId)?.progress === 'active',
    );
    await observe([{ id: 'implementation' }, { ...running, id: 'retry' }, planner], 'active');
    await observe([{ ...running, id: 'retry' }, planner], 'active');
    await observe([{ ...running, retainedAt: '2026-11-01T08:00:00Z' }, planner], 'unknown');
    await observe([running, planner], 'active');
    rmSync(db + '.execution.json');
    await until(
        board,
        (data) =>
            data.items.find((item) => item.id === parent.id)?.slices.find((slice) => slice.workId === sliceId)
                ?.progress === 'unknown',
    );
    await observe([running, planner], 'active');
    await changeRecords(
        board,
        (records) => {
            records.setNeedsYou(sliceId, records.read(sliceId).revision, 'Merge conflict');
        },
        parent.id,
        (item) => item.slices.find((slice) => slice.workId === sliceId)?.progress === 'blocked',
    );
    rmSync(db + '.execution.json');
    await changeRecords(
        board,
        (records) => {
            records.recordFinished(sliceId, records.read(sliceId).revision);
        },
        parent.id,
        (item) => item.slices.find((slice) => slice.workId === sliceId)?.progress === 'done',
    );
});
