import type { ItemStats } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, test, vi } from 'vite-plus/test';

import {
    protocolStatsInputs as fixtureInputs,
    protocolThreadReads as fixtureReads,
} from '../../test/execution-observations.ts';
import { assistant, claudeHome, statsDb, tempDir } from '../../test/stats-db.ts';
import * as transcripts from '../stats/transcript-usage.ts';
import * as execution from './item-execution.ts';
import type { StatsRead } from './t3-reads.ts';
import { createUsageCatchUp, type UsageCatchUpOptions } from './usage-catch-up.ts';

vi.spyOn(execution, 'protocolStatsInputs').mockImplementation(() => fixtureInputs());

const threadReads = vi.spyOn(execution, 'protocolThreadReads').mockImplementation((ids) => fixtureReads(ids));

beforeEach(() => threadReads.mockImplementation((ids) => fixtureReads(ids)));

const turn = { id: 'a1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z' };
const thread = (id: string, read?: 'never' | 'failed') => ({
    id,
    ...(read && { read }),
    sessions: [`session-${id}`],
    turns: [{ ...turn, id: `turn-${id}` }],
});

/** A catch-up over T3's fixture threads, with its stats reads and log lines, whose first read settles when `state.settled` says. */
function catchUp(
    t: Parameters<typeof tempDir>[0],
    threads: Parameters<typeof statsDb>[1],
    ids: string[],
    options: Partial<UsageCatchUpOptions> = {},
) {
    const home = tempDir(t, 'lar-home-');

    claudeHome(
        t,
        Object.fromEntries(threads.map(({ id }) => [`session-${id}`, { main: [assistant(`m-${id}`, 0, 0, 0, 7)] }])),
        join(home, '.claude'),
    );

    const db = statsDb(t, threads);

    vi.stubEnv('T3_STATE_DB', db);
    t.onTestFinished(() => {
        vi.unstubAllEnvs();
    });

    const state = {
        settled: false,
        since: Infinity,
        generation: 0,
        published: [] as StatsRead[],
        logged: [] as string[],
        lines: [] as string[],
        caughtUp: 0,
    };
    const sources = { db, home, settings: join(home, 'settings.json'), rates: join(home, 'rates.json') };

    return {
        state,
        db,
        sources,
        transcript: (id: string) =>
            join(home, '.claude', 'projects', '-Users-me--t3-worktrees-lar-factory-feat-60', `session-${id}.jsonl`),
        catchUp: createUsageCatchUp({
            sources,
            threadIds: () => ids,
            itemThreads: () => ids.map((id) => [id]),
            generation: () => state.generation,
            log: (line) => state.lines.push(line),
            settled: () => state.settled,
            sinceStatsRead: () => state.since,
            paceMs: () => 5_000,
            quietMs: 30_000,
            publish: (reads) => {
                state.published.push(reads as StatsRead);
                state.since = 0;
            },
            caughtUp: () => {
                state.caughtUp++;
            },
            timed: (step) => state.logged.push(step),
            ...options,
        }),
    };
}

test('every read parses asynchronously, through the warm: the first, one at the normal pace and one after a run finishes', async (t) => {
    const warm = vi.spyOn(transcripts, 'warmTranscripts');

    t.onTestFinished(() => warm.mockRestore());

    const { catchUp: usage, state, transcript } = catchUp(t, [thread('a')], ['a']);

    state.settled = true;
    await usage.advance();
    assert.equal(state.published.at(-1)?.parsed, 1);
    assert.equal(warm.mock.calls.length, 1);
    assert.equal(state.caughtUp, 1);

    const tokens = () => (state.published.at(-1)!.stats(['a']) as ItemStats).tokens;

    assert.equal(tokens(), 7);
    appendFileSync(transcript('a'), JSON.stringify(assistant('later', 0, 0, 0, 5)) + '\n');
    state.since = 5_000;
    await usage.want();
    assert.deepEqual(
        [state.published.length, state.published.at(-1)?.parsed, tokens(), warm.mock.calls.length],
        [2, 1, 12, 2],
        'a read at the normal pace',
    );
    appendFileSync(transcript('a'), JSON.stringify(assistant('last', 0, 0, 0, 3)) + '\n');
    state.since = 0;
    assert.equal(usage.owed(), false);
    await usage.want(true);
    assert.deepEqual(
        [state.published.length, state.published.at(-1)?.parsed, tokens(), warm.mock.calls.length],
        [3, 1, 15, 3],
        'a run that finished reads at once, whatever the pace',
    );
    assert.equal(usage.owed(), false);
});

test('an ask before catching up has finished changes nothing, and one at the pace waits for it', async (t) => {
    const { catchUp: usage, state } = catchUp(t, [thread('a')], ['a']);

    await usage.want(true);
    assert.equal(state.published.length, 0, 'catching up runs its own reads');
    state.settled = true;
    await usage.advance();
    assert.equal(state.published.length, 1);
    state.since = 4_999;
    await usage.want();
    assert.equal(state.published.length, 1, 'too soon');
    state.since = 5_000;
    await usage.advance();
    assert.equal(state.published.length, 2, 'the ask stands until the pace allows it');
    state.since = 5_000;
    await usage.advance();
    assert.equal(state.published.length, 2, 'and earns one read');
});

test('each read logs its whole path during catch-up, the first ordinary one too, and one after only when it blocks or runs long', async (t) => {
    const { catchUp: usage, state } = catchUp(t, [thread('a')], ['a']);

    state.settled = true;
    await usage.advance();

    const path =
        /^stats read path took \d+ ms elapsed, \d+ ms CPU: inputs \d+ ms, discovery \d+ ms, warm \d+ ms \(parsed 1 of 1 transcripts\), dedup \d+ ms, aggregation \d+ ms, publish \d+ ms; longest block \d+ ms in (inputs|discovery|warm|dedup|aggregation|publish)$/;

    assert.ok(
        state.logged.some((line) => path.test(line)),
        state.logged.join('\n'),
    );
    assert.ok(
        state.logged.some((line) =>
            /^stats read took \d+ ms elapsed, \d+ ms CPU, after warming 1 transcripts in \d+ ms, longest \d+ ms$/.test(
                line,
            ),
        ),
        state.logged.join('\n'),
    );
    state.since = 5_000;
    await usage.want();
    assert.equal(state.lines.length, 1, 'the first ordinary read logs');
    assert.match(state.lines[0]!, /^stats read path took /);
    state.since = 5_000;
    await usage.want();
    assert.equal(state.lines.length, 1, 'a short read with no block says nothing');
});

test('a thread joining the board during a read leaves that read provisional, so its figures reach no retained total or PR block', async (t) => {
    const held = heldWarms(t);
    const ids = ['a'];
    const { catchUp: usage, state } = catchUp(t, [thread('a'), thread('b')], ids);

    state.settled = true;

    const first = usage.advance();

    await until(() => held.calls === 1);
    ids.push('b');
    held.release.shift()!();
    await until(() => state.published.length === 1);
    assert.equal(state.published[0]!.allObserved, false);
    state.since = 5_000;

    const next = first.then(() => usage.advance());

    await until(() => held.calls === 2);
    held.release.shift()!();
    await next;
    assert.equal(state.published.at(-1)!.allObserved, true, 'the next read covers both threads');
});

test('a read a deletion overtook shows nothing, and the follow-up does', async (t) => {
    const held = heldWarms(t);
    const { catchUp: usage, state } = catchUp(t, [thread('a')], ['a'], { paceMs: () => 0 });
    const first = usage.advance();

    await until(() => held.calls === 1);
    state.generation++;
    held.release.shift()!();
    await until(() => held.calls === 2);
    assert.equal(state.published.length, 0, 'the overtaken read stayed unshown');
    held.release.shift()!();
    await first;
    assert.equal(state.published.length, 1);
});

test('warmup waits for an item with a thread or the settled first read', async (t) => {
    const { catchUp: usage, state } = catchUp(t, [], []);

    await usage.advance();
    assert.deepEqual(state.logged, []);
    state.settled = true;
    await usage.advance();
    assert.deepEqual(state.logged, [
        'warmup started',
        'thread reads complete (read 0, failed 0, total 0)',
        'every item settled',
    ]);
    assert.equal(state.caughtUp, 1, 'and it catches up with no thread to wait for');
    assert.equal(state.published.length, 0);
});

test('stats reads run when reads land, at the catch-up pace, and wait for no thread that failed', async (t) => {
    const {
        catchUp: usage,
        state,
        db,
    } = catchUp(t, [thread('a'), thread('b', 'never'), thread('c', 'failed')], ['a', 'b', 'c']);

    await usage.advance();
    assert.equal(state.published.length, 1);
    state.since = 4_999;
    writeFileSync(`${db}.execution.json`, JSON.stringify([thread('a'), thread('b'), thread('c', 'failed')]));
    await usage.advance();
    assert.equal(state.published.length, 1, 'at most one stats read in the pace');
    state.since = 5_000;
    state.settled = true;
    await usage.advance();
    assert.equal(state.published.length, 2);
    assert.equal(state.caughtUp, 1);
    assert.ok(state.logged.includes('thread reads complete (read 2, failed 1, total 3)'), state.logged.join('\n'));
    assert.equal(state.logged.at(-1), 'every item settled');
    state.since = 5_000;
    await usage.advance();
    assert.equal(state.published.length, 2, 'nothing new landed');
});

test('a thread recorded after catch-up and a read that later succeeds each get a warm first', async (t) => {
    const ids = ['a'];
    const { catchUp: usage, state } = catchUp(t, [thread('a'), thread('b')], ids);

    state.settled = true;
    await usage.advance();
    assert.equal(state.caughtUp, 1);
    ids.push('b');
    threadReads.mockImplementation(() => ({
        reads: new Map([
            ['a', 'current'],
            ['b', 'failed'],
        ]),
        observed: new Set(['a']),
        demand() {},
    }));
    state.since = 5_000;
    await usage.want();
    assert.equal(state.published.length, 2, 'b was never covered');
    state.since = 5_000;
    await usage.advance();
    assert.equal(state.published.length, 2, 'a failed read with no observation has no transcript to warm');
    threadReads.mockImplementation(() => ({
        reads: new Map([
            ['a', 'current'],
            ['b', 'current'],
        ]),
        observed: new Set(['a', 'b']),
        demand() {},
    }));
    state.since = 5_000;
    await usage.want();
    assert.equal(state.published.length, 3, 'its success names transcripts no warm read');
    assert.equal(state.caughtUp, 1, 'catching up logs and writes once');
});

/** Holds each warm until the test releases it, counting those running at once. */
function heldWarms(t: Parameters<typeof tempDir>[0]) {
    const held = { running: 0, peak: 0, calls: 0, release: [] as (() => void)[] };
    const warm = vi.spyOn(transcripts, 'warmTranscripts').mockImplementation(
        () =>
            new Promise((resolve) => {
                held.calls++;
                held.peak = Math.max(held.peak, ++held.running);
                held.release.push(() => {
                    held.running--;
                    resolve({ records: new Map(), parsed: 0 });
                });
            }),
    );

    t.onTestFinished(() => warm.mockRestore());

    return held;
}

const until = (done: () => boolean) => vi.waitFor(() => assert.ok(done()));

test('no warm or stats read overlaps another: a stats read waits while a warm runs', async (t) => {
    const held = heldWarms(t);
    const { catchUp: usage, state } = catchUp(t, [thread('a')], ['a'], { paceMs: () => 0 });
    const first = usage.advance();

    await until(() => held.calls === 1);

    const during = await Promise.all([usage.advance(), usage.advance()]);

    assert.deepEqual(during, [undefined, undefined]);
    assert.equal(usage.reading(), true, 'the stats reads of other paths wait for it');
    assert.equal(state.published.length, 0, 'the stats read follows its warm');
    assert.equal(held.calls, 1);
    held.release.shift()!();
    await first;
    assert.equal(held.peak, 1);
    assert.equal(state.published.length, 1);
});

test('triggers during a run coalesce into one follow-up, and with none there is none', async (t) => {
    const held = heldWarms(t);
    const ids = ['a'];
    const { catchUp: usage, state } = catchUp(t, [thread('a'), thread('b'), thread('c')], ids, { paceMs: () => 0 });
    const first = usage.advance();

    await until(() => held.calls === 1);
    ids.push('b');
    for (let i = 0; i < 5; i++) await usage.advance();
    held.release.shift()!();
    await until(() => held.calls === 2);
    ids.push('c');
    held.release.shift()!();
    await first;
    assert.equal(
        held.calls,
        2,
        'five triggers made one follow-up, and c, with no trigger during that run, waits for the next tick',
    );
    assert.equal(state.published.length, 2);

    const next = usage.advance();

    await until(() => held.calls === 3);
    held.release.shift()!();
    await next;
    assert.equal(state.published.length, 3);
    assert.equal(held.peak, 1);
});

test('a failing thread schedules nothing: repeated ticks read stats once and only demand its read', async (t) => {
    const { catchUp: usage, state } = catchUp(t, [thread('a')], ['a', 'b'], { paceMs: () => 0 });
    let demands = 0;

    threadReads.mockImplementation(() => ({
        reads: new Map([
            ['a', 'current'],
            ['b', 'failed'],
            ['c', 'never'],
        ]),
        observed: new Set(['a']),
        demand() {
            demands++;
        },
    }));
    for (let i = 0; i < 50; i++) await usage.advance();
    assert.equal(
        state.published.length,
        1,
        'a failure that lands once needs one stats read, however often the board ticks',
    );
    assert.equal(demands, 51, 'one demand each tick, and one for the follow-up check, which retryAt then limits');

    const timers = vi.spyOn(globalThis, 'setTimeout');

    t.onTestFinished(() => timers.mockRestore());
    await usage.advance();
    assert.equal(timers.mock.calls.length, 0, 'it starts no timer of its own');
});

test('a caught-up board looks for nothing until a stats read finds a thread waiting', async (t) => {
    const ids = ['a'];
    const threadIds = vi.fn(() => ids);
    const { catchUp: usage, state } = catchUp(t, [thread('a'), thread('b')], ids, { threadIds });

    state.settled = true;
    await usage.advance();
    assert.equal(state.caughtUp, 1);
    threadIds.mockClear();
    threadReads.mockClear();
    for (let i = 0; i < 10; i++) await usage.advance();
    assert.equal(threadIds.mock.calls.length, 0);
    assert.equal(threadReads.mock.calls.length, 0);
    ids.push('b');
    state.since = 5_000;
    await usage.want();
    assert.equal(state.published.length, 2);
});

test('an unreadable database reports at once, holds up no settling, and its recovery still warms first', async (t) => {
    const { state, sources } = catchUp(t, [thread('a')], ['a']);
    const missing = createUsageCatchUp({
        sources: { ...sources, db: join(tempDir(t, 'lar-gone-'), 'gone.sqlite') },
        threadIds: () => ['a'],
        itemThreads: () => [['a']],
        generation: () => 0,
        log: () => {},
        settled: () => true,
        sinceStatsRead: () => state.since,
        paceMs: () => 30_000,
        quietMs: 30_000,
        publish: (reads) => {
            state.published.push(reads as StatsRead);
            state.since = 0;
        },
        caughtUp: () => {
            state.caughtUp++;
        },
        timed: () => {},
    });

    await missing.advance();
    assert.equal(state.published[0]?.statsUnavailable, true);
    assert.equal(state.caughtUp, 1);
    state.since = 29_999;
    await missing.advance();
    assert.equal(state.published.length, 1, 'recovery waits for the normal pace');
});

test('an urgent read stays owed until it publishes, and a dropped one until its follow-up does', async (t) => {
    const held = heldWarms(t);
    const owedAtPublish: boolean[] = [];
    const { catchUp: usage, state } = catchUp(t, [thread('a')], ['a'], {
        publish: (reads) => {
            owedAtPublish.push(usage.owed());
            state.published.push(reads as StatsRead);
            state.since = 0;
        },
    });

    state.settled = true;

    const first = usage.advance();

    await until(() => held.calls === 1);
    held.release.shift()!();
    await first;
    state.since = 0;

    const urgent = usage.want(true);

    await until(() => held.calls === 2);
    assert.equal(usage.owed(), true, 'a PR block written now would miss the last turn');
    state.generation++;
    held.release.shift()!();
    await until(() => held.calls === 3);
    assert.equal(usage.owed(), true, 'the dropped read is owed again');
    held.release.shift()!();
    await urgent;
    assert.equal(state.published.length, 2);
    assert.deepEqual(
        owedAtPublish,
        [false, false],
        'the read that publishes pays what was owed, so its own PR write may run',
    );
    assert.equal(usage.owed(), false);
});
