import { readingScope } from '@lar-factory/shared';
import type { BoardData, ItemStats } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { startBoard, until } from './server-support.ts';
import { assistant, claudeHome, statsDb, t3Settings } from './stats-db.ts';

const settled = (board: Parameters<typeof until>[0]) => until(board, (d) => d.firstRead.settled);

/** A file whose existence holds every delayed repository's read, so a test knows which read lands first; removing it lets them finish. */
async function heldReads(t: TestContext): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'lar-first-read-hold-'));

    t.onTestFinished(() => rm(dir, { recursive: true, force: true }));

    const hold = join(dir, 'hold');

    await writeFile(hold, '');

    return hold;
}

/** Every first read the board's stream pushes, up to the settled one. */
async function pushedFirstReads(t: TestContext, board: { url: string }): Promise<BoardData['firstRead'][]> {
    const abort = new AbortController();

    t.onTestFinished(() => abort.abort());

    const response = await fetch(`${board.url}/api/events`, { signal: abort.signal });
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    const seen: BoardData['firstRead'][] = [];
    let buffered = '';
    const deadline = Date.now() + 8_000;

    while (Date.now() < deadline && !seen.at(-1)?.settled) {
        const { value, done } = await reader.read();

        if (done) break;

        buffered += value;

        const events = buffered.split('\n\n');

        buffered = events.pop()!;
        for (const event of events) {
            const data = event
                .split('\n')
                .filter((line) => line.startsWith('data: '))
                .map((line) => line.slice(6))
                .join('\n');

            if (data) seen.push((JSON.parse(data) as BoardData).firstRead);
        }
    }

    return seen;
}

test('the first read settles once the repositories are read, with nothing running', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(1, 'List')] });
    const data = await settled(board);

    assert.ok(data.fetchedAt, 'the read finished');
    assert.deepEqual(data.firstRead, { step: 'finishing', running: [], settled: true });
});

test('the first read settles when the read fails', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(1, 'List')], fail: 'read' });
    const data = await settled(board);

    assert.match(data.error ?? '', /502/);
    assert.equal(data.fetchedAt, null);
});

test('the first read settles when gh is logged out at launch, though the read never starts', async (t) => {
    const board = await startBoard(t, { ghAuth: 'logged-out' });
    const data = await settled(board);

    assert.equal(data.tools?.gh?.result, 'logged-out');
    assert.equal(data.fetchedAt, null);
    assert.equal((await board.calls()).filter((args) => args[1] === 'graphql').length, 0);
});

test('a read after the first never un-settles it', async (t) => {
    const board = await startBoard(t, { items: [boardIssue(1, 'List')] });

    await settled(board);
    await fetch(`${board.url}/api/read`, {
        method: 'POST',
        headers: { Origin: board.url, 'Content-Type': 'application/json' },
        body: '{}',
    });
    await board.update({ items: [boardIssue(1, 'List', 'maddec01/lar-factory', ['bug'])] });
    await until(board, (d) => d.items[0]?.labels.includes('bug') === true);
    assert.equal(((await board.board()) as BoardData).firstRead.settled, true);
});

test('the stream pushes the first read as it moves from unsettled to settled, naming what runs', async (t) => {
    const board = await startBoard(t, {
        items: [boardIssue(1, 'List')],
        readDelay: 400,
        repositories: ['maddec01/lar-server', 'maddec01/lar-apple'],
    });
    const seen = await pushedFirstReads(t, board);

    assert.equal(seen.at(-1)?.settled, true);
    assert.ok(
        seen.some((f) => f.step === 'items' && f.running.length > 0),
        `a push names the reads running: ${JSON.stringify(seen)}`,
    );

    const first = seen.findIndex((f) => f.settled);

    assert.ok(
        seen.slice(first).every((f) => f.settled),
        'a push after the settled one never un-settles it',
    );

    // The configs may load before the first provider check lands, which the stream waits for, so it can miss the first step.
    const steps = seen
        .slice(0, first)
        .map((f) => f.step)
        .filter((step, at, all) => all.indexOf(step) === at);

    assert.deepEqual(steps, ['repositories', 'items', 'finishing'].slice(-steps.length));
    assert.deepEqual(seen[first], { step: 'finishing', running: [], settled: true });
});

test('every repository counts as reading until the waiting repositories are known, and after that only the pending ones', async (t) => {
    const apple = 'maddec01/lar-apple';
    const all = [apple, 'maddec01/lar-factory', 'maddec01/lar-server'];
    const hold = await heldReads(t);
    const board = await startBoard(t, {
        items: [boardIssue(1, 'List')],
        readHold: hold,
        localSetups: { [apple]: { role: 'Apple client', itemSource: { kind: 'issues' } } },
        repoIssues: { [apple]: [boardIssue(7, 'List', apple).content] },
    });
    const pushed = pushedFirstReads(t, board);

    await until(board, (d) => d.items.length > 0);
    // A read asked for now runs once the first ends, and finds nobody left waiting.
    await fetch(`${board.url}/api/read`, {
        method: 'POST',
        headers: { Origin: board.url, 'Content-Type': 'application/json' },
        body: '{}',
    });
    await rm(hold);

    const seen = await pushed;
    const unsettled = seen.filter((f) => !f.settled);
    const known = unsettled.findIndex((f) => f.waiting);

    assert.deepEqual(
        [...unsettled[known]!.waiting!].sort(),
        all,
        `the first list names every repository: ${JSON.stringify(seen)}`,
    );

    const reading = (f: BoardData['firstRead']) => all.filter((repo) => readingScope({ firstRead: f }, repo)).sort();

    for (const f of unsettled.slice(0, known)) assert.deepEqual(reading(f), all);
    for (const f of unsettled.slice(known)) assert.deepEqual(reading(f), [...f.waiting!].sort());
    assert.ok(
        unsettled.some((f) => f.waiting?.length === 0),
        `the list empties before the read settles: ${JSON.stringify(seen)}`,
    );
    unsettled.slice(known + 1).forEach((f, at) => {
        const before = unsettled[known + at]!.waiting!;

        assert.ok(
            f.waiting!.every((repo) => before.includes(repo)),
            `a repository that landed stays landed: ${JSON.stringify(seen)}`,
        );
    });
});

test('a first load of the repositories that fails settles the first read, so no count stays hidden', async (t) => {
    const home = await mkdtemp(join(tmpdir(), 'lar-first-read-home-'));

    t.onTestFinished(() => rm(home, { recursive: true, force: true }));

    const dir = join(home, 'Library/Application Support/Lar Factory');

    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'repository-settings.json'), '{ broken');

    const board = await startBoard(t, {}, false, false, { HOME: home });
    const seen = await pushedFirstReads(t, board);

    assert.ok(
        seen.every((f) => f.waiting === undefined),
        `no list before the repositories are known: ${JSON.stringify(seen)}`,
    );

    const data = await settled(board);

    assert.match(data.error ?? '', /isn't valid JSON/);
    assert.deepEqual(data.firstRead, { step: 'repositories', running: [], settled: true });
    assert.equal(readingScope(data, 'maddec01/lar-factory'), false);
});

test("each repository's items show once its own read lands, while another repository's read still runs", async (t) => {
    const apple = 'maddec01/lar-apple';
    const hold = await heldReads(t);
    const board = await startBoard(t, {
        items: [boardIssue(1, 'List')],
        readHold: hold,
        localSetups: { [apple]: { role: 'Apple client', itemSource: { kind: 'issues' } } },
        repoIssues: { [apple]: [boardIssue(7, 'List', apple).content] },
    });
    const early = await until(board, (d) => d.items.length > 0);

    assert.deepEqual(
        early.items.map((i) => [i.repo, i.number]),
        [[apple, 7]],
        "the repository's read still sleeps",
    );
    assert.equal(early.firstRead.settled, false);
    assert.equal(early.firstRead.ready, true);
    assert.deepEqual(early.firstRead.waiting, ['maddec01/lar-server', 'maddec01/lar-factory']);
    assert.equal(early.fetchedAt, null, 'the whole read has yet to land');
    assert.equal(early.error, null);
    await rm(hold);

    const data = await settled(board);

    assert.deepEqual(
        data.items.map((i) => [i.repo, i.number]).sort((a, b) => String(a).localeCompare(String(b))),
        [
            [apple, 7],
            ['maddec01/lar-factory', 1],
        ],
    );
    assert.deepEqual(data.firstRead, { step: 'finishing', running: [], settled: true });
});

test('an item with recorded threads shows figures while another repository still reads, and a ticketed record there stays hidden', async (t) => {
    const apple = 'maddec01/lar-apple';
    const home = claudeHome(t, {
        'session-a': { main: [assistant('a', 0, 0, 0, 7)] },
        'session-b': { main: [assistant('b', 0, 0, 0, 9)] },
    });
    const thread = (id: string) => ({
        id,
        sessions: [{ session: `session-${id}`, instance: 'claudeAgent_personal' }],
        turns: [{ id: `turn-${id}`, startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' }],
    });
    const hold = await heldReads(t);
    const board = await startBoard(
        t,
        {
            items: [boardIssue(1, 'List')],
            readHold: hold,
            threads: { [`${apple}#7`]: ['a'], 'maddec01/lar-factory#1': ['b'] },
            localSetups: { [apple]: { role: 'Apple client', itemSource: { kind: 'issues' } } },
            repoIssues: { [apple]: [boardIssue(7, 'List', apple).content] },
        },
        false,
        false,
        {
            T3_STATE_DB: statsDb(t, [thread('a'), thread('b')]),
            T3_SETTINGS: t3Settings(t, { claudeAgent_personal: home }),
        },
    );
    const early = await until(board, (d) => typeof d.items[0]?.stats === 'object');

    assert.equal(early.firstRead.settled, false);
    assert.deepEqual(
        early.items.map((i) => [i.repo, i.number]),
        [[apple, 7]],
        'the ticketed record in the held repository stays hidden',
    );
    assert.deepEqual(early.items[0]?.stats, {
        agentMs: 30 * 60_000,
        wallMs: 30 * 60_000,
        tokens: 7,
        provisional: true,
    });
    assert.equal(early.items[0]?.usageState, 'current');
    await rm(hold);

    const data = await until(
        board,
        (d) => d.firstRead.settled && d.items.every((i) => typeof i.stats === 'object' && !i.stats.provisional),
    );

    assert.deepEqual(
        data.items.map((i) => (i.stats as ItemStats).tokens).sort((a, b) => a - b),
        [7, 9],
        'the figures settle once the first read does',
    );
    await board.untilLogged('every item settled');
    for (const step of [
        'server listening',
        'records shown (1 items)',
        'warmup started',
        'first item with figures',
        'first read settled',
        'every item settled',
    ])
        assert.match(board.logs(), new RegExp(`startup \\d+ ms: ${step.replace(/[()]/g, '\\$&')}`));
    assert.match(board.logs(), /startup \d+ ms: thread reads complete \(read \d+, failed 0, total \d+\)/);
    assert.match(
        board.logs(),
        /startup \d+ ms: stats read took \d+ ms elapsed, \d+ ms CPU, after warming \d+ transcripts in \d+ ms, longest \d+ ms/,
    );
    assert.match(
        board.logs(),
        /startup \d+ ms: stats read path took \d+ ms elapsed, \d+ ms CPU: inputs \d+ ms, discovery \d+ ms, warm \d+ ms \(parsed \d+ of \d+ transcripts\), dedup \d+ ms, aggregation \d+ ms, publish \d+ ms; longest block \d+ ms in \w+/,
    );
});
