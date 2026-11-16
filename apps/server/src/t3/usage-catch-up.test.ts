import type { ItemStats } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
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
