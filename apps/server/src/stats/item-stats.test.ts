import type { ItemStats } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import { protocolStatsInputs } from '../../test/execution-observations.ts';
import {
    assistant,
    claudeHome,
    codexHome,
    codexSession,
    codexTokens,
    statsDb,
    t3Settings,
    tempDir,
    usageRates,
} from '../../test/stats-db.ts';
import type { FixtureThread } from '../../test/stats-db.ts';
import { readT3Db, threadRows, threadSessions } from '../t3/t3-db.ts';
import { issueKey, namedIssue } from '../threads/item-threads.ts';
import { DEDUP_RECORDS_PER_CHUNK, itemStats } from './item-stats.ts';
import type { StatsSources } from './item-stats.ts';
import { createReadTrace } from './read-trace.ts';
import type { ReadTrace } from './read-trace.ts';

/** A home folder, settings and price table that don't exist, so tests never read real transcripts. */
const NOWHERE = {
    settings: join(tmpdir(), 'no-such-dir', 'settings.json'),
    rates: join(tmpdir(), 'no-such-dir', 'usage-model-rates.json'),
    home: join(tmpdir(), 'no-such-dir', 'home'),
};

const NOW = Date.parse('2026-10-20T12:00:00Z');
const REPO = 'maddec01/lar-factory';
const MIN = 60_000;

/** A finished ten-minute turn. */
function turn(id: string) {
    return { id, startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z' };
}

/**
 * An item's stats by repo and issue number: the fixtures name each item's root threads in their first message, and the
 * reader gets those threads' IDs, as the item's work record would hold them.
 */
type IssueStats = ((repo: string, number: number) => ItemStats | null) & { priced: boolean };

async function reader(db: string, sources: Partial<StatsSources> = {}): Promise<IssueStats> {
    const { sqlRows, sqlSessions } = readT3Db(db, (open) => ({
        sqlRows: threadRows(open),
        sqlSessions: threadSessions(open),
    }));

    {
        const before = await itemStats({ db, ...NOWHERE, ...sources }, sqlRows, NOW, { sessions: sqlSessions });
        const threadIds = (repo: string, number: number) =>
            sqlRows.threads
                .filter(
                    (t) =>
                        (t.root ?? t.id) === t.id &&
                        typeof t.text === 'string' &&
                        namedIssue(t.text) === issueKey(repo, number),
                )
                .map((t) => t.id);
        const previous = process.env.T3_STATE_DB;

        process.env.T3_STATE_DB = db;

        try {
            const { rows, sessions } = await protocolStatsInputs();
            const after = await itemStats({ db, ...NOWHERE, ...sources }, rows, NOW, { sessions });

            return Object.assign(
                (repo: string, number: number) => {
                    const actual = after(threadIds(repo, number));

                    assert.deepEqual(actual, before(threadIds(repo, number)), 'protocol and SQL stats parity');

                    return actual;
                },
                { priced: after.priced },
            );
        } finally {
            if (previous === undefined) delete process.env.T3_STATE_DB;
            else process.env.T3_STATE_DB = previous;
        }
    }
}

/** A ten-minute root turn naming issue `n`, from 09:00. */
function root(n: number): FixtureThread {
    return { id: `root-${n}`, messages: [`Build ${REPO}#${n}`], turns: [turn(`root-${n}`)] };
}

/** A turn-less subagent child of `root(n)` running from `start` to `end` (HH:MM on the test day). */
function subagent(
    id: string,
    n: number,
    start: string,
    end: string | null,
    extra: Partial<FixtureThread> = {},
): FixtureThread {
    const at = (hm: string) => `2026-10-20T${hm}:00Z`;

    return { id, rootThreadId: `root-${n}`, subagent: { startedAt: at(start), completedAt: end && at(end) }, ...extra };
}

test("a subagent adds the part of its run outside its parent's turns, and parallel siblings add up", async (t) => {
    const stats = await reader(
        statsDb(t, [
            root(1),
            subagent('background', 1, '09:10', '09:25'),
            root(2),
            subagent('foreground', 2, '09:02', '09:08'),
            // A Codex-style child: its own turns count, not its run, which T3 repeats.
            root(3),
            {
                id: 'codex',
                rootThreadId: 'root-3',
                subagent: [
                    { startedAt: '2026-10-20T09:01:00Z', completedAt: '2026-10-20T09:30:00Z' },
                    { startedAt: '2026-10-20T09:01:00Z', completedAt: '2026-10-20T09:30:00Z' },
                ],
                turns: [
                    { id: 'c1', startedAt: '2026-10-20T09:01:00Z', completedAt: '2026-10-20T09:04:00Z' },
                    { id: 'c2', startedAt: '2026-10-20T09:05:00Z', completedAt: '2026-10-20T09:09:00Z' },
                ],
            },
            root(4),
            subagent('left', 4, '09:10', '09:25'),
            subagent('right', 4, '09:10', '09:25'),
            // One child's repeated runs are merged before counting.
            root(5),
            {
                id: 'repeated',
                rootThreadId: 'root-5',
                subagent: [
                    { startedAt: '2026-10-20T09:10:00Z', completedAt: '2026-10-20T09:20:00Z' },
                    { startedAt: '2026-10-20T09:15:00Z', completedAt: '2026-10-20T09:25:00Z' },
                ],
            },
        ]),
    );

    assert.equal(stats(REPO, 1)?.agentMs, 25 * MIN);
    assert.equal(stats(REPO, 2)?.agentMs, 10 * MIN, 'a parent waiting on its subagent counts once');
    assert.equal(stats(REPO, 3)?.agentMs, 10 * MIN, "a child working inside its parent's turn adds nothing");
    assert.equal(stats(REPO, 4)?.agentMs, 40 * MIN);
    assert.equal(stats(REPO, 5)?.agentMs, 25 * MIN);
});

test("wall time is the time any of the item's agents worked: overlap once, no waits on the user, no idle gaps", async (t) => {
    const stats = await reader(
        statsDb(
            t,
            [
                root(1),
                subagent('left', 1, '09:10', '09:25'),
                subagent('right', 1, '09:15', '09:30'),
                {
                    id: 'waits',
                    messages: [`$lar-work ${REPO}#2`],
                    turns: [{ id: 'w', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T10:00:00Z' }],
                },
                root(3),
                {
                    id: 'later',
                    messages: [`$lar-work ${REPO}#3`],
                    turns: [{ id: 'l', startedAt: '2026-10-20T11:00:00Z', completedAt: '2026-10-20T11:05:00Z' }],
                },
            ],
            [{ turnId: 'w', createdAt: '2026-10-20T09:10:00Z', resolvedAt: '2026-10-20T09:40:00Z' }],
        ),
    );

    assert.equal(stats(REPO, 1)?.agentMs, 40 * MIN);
    assert.equal(stats(REPO, 1)?.wallMs, 30 * MIN, 'parallel subagents count their overlap once');
    assert.equal(stats(REPO, 2)?.wallMs, 30 * MIN, 'waits on the user are left out');
    assert.equal(stats(REPO, 3)?.wallMs, 15 * MIN, "the gap between threads isn't counted");
});

test("tokens are T3's totals over each session's own and subagent transcripts, each message once", async (t) => {
    const home = tempDir(t, 'lar-home-');

    claudeHome(
        t,
        {
            'session-a1': {
                main: [
                    { type: 'user', message: { role: 'user', content: 'Review the branch' } },
                    // One record per content block, each repeating the message's usage: counted once.
                    assistant('msg-1', 2, 1000, 5000, 40),
                    assistant('msg-1', 2, 1000, 5000, 40),
                    // A local placeholder and a model-less record never reached the API.
                    assistant('msg-placeholder', 0, 0, 0, 9, '<synthetic>'),
                    assistant('msg-modelless', 9, 9, 9, 9, ''),
                ],
                subagents: { a1: [assistant('msg-2', 1, 0, 6000, 100)], a2: [assistant('msg-3', 10, 0, 0, 5)] },
            },
            'session-a2': { main: [assistant('msg-4', 0, 100, 0, 1)] },
            'session-other': { main: [assistant('msg-5', 99, 0, 0, 99)] },
        },
        join(home, '.claude'),
    );

    const stats = await reader(
        statsDb(t, [
            // A thread with two provider threads: both sessions count.
            {
                id: 'build',
                messages: [`Build ${REPO}#60`],
                sessions: ['session-a1', 'session-a2'],
                turns: [turn('t1')],
            },
            { id: 'other', messages: [`$lar-work ${REPO}#61`], sessions: ['session-other'] },
            { id: 'plain', messages: [`$lar-work ${REPO}#62`], sessions: ['session-none'], turns: [turn('t2')] },
        ]),
        { home },
    );

    assert.deepEqual(stats(REPO, 60), { agentMs: 10 * MIN, wallMs: 10 * MIN, tokens: 6042 + 6101 + 15 + 101 });
    assert.equal(stats(REPO, 61)?.tokens, 198);
    assert.deepEqual(stats(REPO, 62), { agentMs: 10 * MIN, wallMs: 10 * MIN, tokens: 0 }, 'no transcripts, no tokens');
});

test("an item totals its Claude and Codex threads, each Codex thread from its own instance's Codex home", async (t) => {
    const home = tempDir(t, 'lar-home-');
    const build = '01a13627-9790-70d0-8342-58f71022e222';
    const child = '01a13628-c84a-7f33-9a04-c55eb4c75845';
    const other = '01a13628-ffd8-70c1-a4a8-67217b17f950';

    claudeHome(t, { 'session-claude': { main: [assistant('msg-1', 2, 1000, 5000, 40)] } }, join(home, '.claude'));
    codexHome(
        t,
        {
            [build]: [
                ...codexSession(build),
                codexTokens('2026-10-20T09:01:00.000Z', 1000, 400, 50, [1000, 400, 50]),
                codexTokens('2026-10-20T09:02:00.000Z', 2000, 1500, 70, [3000, 1900, 120]),
            ],
            // A child thread's rollout opens with a copy of its parent's history, counted for the parent only.
            [child]: [
                ...codexSession(child, 'gpt-5.6-sol', build),
                codexTokens('2026-10-20T09:00:00.000Z', 1000, 400, 50, [1000, 400, 50]),
                codexTokens('2026-10-20T09:05:00.000Z', 300, 0, 9, [1300, 400, 59]),
            ],
        },
        join(home, '.codex'),
    );

    const elsewhere = codexHome(t, {
        [other]: [...codexSession(other), codexTokens('2026-10-20T09:01:00.000Z', 7, 0, 1)],
    });
    const db = statsDb(t, [
        {
            id: 'build',
            messages: [`Build ${REPO}#60`],
            turns: [turn('t1')],
            sessions: ['session-claude', { session: build, instance: 'codex', driver: 'codex' }],
        },
        { id: 'child', rootThreadId: 'build', sessions: [{ session: child, instance: 'codex', driver: 'codex' }] },
        {
            id: 'other',
            messages: [`$lar-work ${REPO}#61`],
            sessions: [{ session: other, instance: 'codex_work', driver: 'codex' }],
        },
    ]);
    const settings = t3Settings(t, { codex_work: { driver: 'codex', homePath: elsewhere } });
    const stats = await reader(db, { settings, home });

    assert.deepEqual(stats(REPO, 60), { agentMs: 10 * MIN, wallMs: 10 * MIN, tokens: 6042 + 1050 + 2070 + 309 });
    assert.equal(stats(REPO, 61)?.tokens, 8);
});

test('a record forked threads share counts once, for the item whose thread produced it first', async (t) => {
    const home = tempDir(t, 'lar-home-');

    claudeHome(
        t,
        {
            original: { main: [assistant('msg-1', 0, 0, 500, 0), assistant('msg-2', 0, 0, 60, 0)] },
            // A fork copies the original's records forward, then adds its own.
            fork: {
                main: [
                    assistant('msg-1', 0, 0, 500, 0),
                    assistant('msg-2', 0, 0, 60, 0),
                    assistant('msg-3', 0, 0, 7, 0),
                ],
            },
        },
        join(home, '.claude'),
    );

    const stats = await reader(
        statsDb(t, [
            // Listed first, but created after the original.
            {
                id: 'forked',
                messages: [`$lar-work ${REPO}#61`],
                sessions: [{ session: 'fork', createdAt: '2026-10-20T10:00:00.000Z' }],
            },
            {
                id: 'first',
                messages: [`$lar-work ${REPO}#60`],
                sessions: [{ session: 'original', createdAt: '2026-10-20T09:00:00.000Z' }],
            },
        ]),
        { home },
    );

    assert.equal(stats(REPO, 60)?.tokens, 560);
    assert.equal(stats(REPO, 61)?.tokens, 7);
});

const close = (actual: number | undefined, expected: number) =>
    assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test("API cost is T3's price for the item's records, with the aliases and overrides in T3's settings", async (t) => {
    const home = tempDir(t, 'lar-home-');

    claudeHome(
        t,
        {
            'session-a': {
                main: [
                    assistant('m1', 1000, 2000, 10000, 500, 'claude-opus-4-1'),
                    // No cache rates in the table: cached tokens cost the input rate.
                    assistant('m2', 1000, 1000, 1000, 0, 'claude-fable-5-1[1m]'),
                    // Aliased to a model only the user's override prices.
                    assistant('m3', 1000, 0, 0, 100, 'internal-model'),
                    // The provider's own cost goes ahead of the table.
                    { ...assistant('m4', 9999, 0, 0, 9999, 'claude-opus-4-1'), costUSD: 0.25 },
                    assistant('m5', 9999, 0, 0, 9999, 'mystery-model'),
                ],
            },
            'session-b': {
                main: [assistant('m6', 1000, 0, 0, 0, 'mystery-model'), assistant('m7', 1000, 0, 0, 0, 'opus')],
            },
        },
        join(home, '.claude'),
    );

    const db = statsDb(t, [
        { id: 'priced', messages: [`$lar-work ${REPO}#60`], sessions: ['session-a'] },
        { id: 'unpriced', messages: [`$lar-work ${REPO}#61`], sessions: ['session-b'] },
    ]);
    const settings = t3Settings(
        t,
        {},
        {
            usageModelAliases: { 'internal-model': 'my-proxy' },
            usagePriceOverrides: {
                'my-proxy': { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 },
                broken: { inputCostPerMillionTokens: -1 },
            },
        },
    );
    const rates = usageRates(t, {
        'claude-opus-4-1': {
            input_cost_per_token: 1.5e-5,
            output_cost_per_token: 7.5e-5,
            cache_read_input_token_cost: 1.5e-6,
            cache_creation_input_token_cost: 1.875e-5,
        },
        'claude-fable-5-1': { input_cost_per_token: 1e-5, output_cost_per_token: 5e-5 },
    });
    const stats = await reader(db, { home, settings, rates });

    close(stats(REPO, 60)?.costUsd, 0.105 + 0.03 + 0.0028 + 0.25);
    assert.deepEqual(stats(REPO, 61), { agentMs: 0, wallMs: 0, tokens: 2000 }, 'nothing priced, no cost');
    // Without T3's price table there is no cost, and the rest of the stats stand.
    assert.deepEqual((await reader(db, { home, settings }))(REPO, 60), {
        agentMs: 0,
        wallMs: 0,
        tokens: 13500 + 3000 + 1100 + 9999 * 4,
    });
    assert.equal(stats.priced, true);
    assert.equal(
        (await reader(db, { home, settings })).priced,
        false,
        'the server logs when pricing goes and comes back',
    );
    assert.equal(
        (await reader(db, { home, settings, rates: usageRates(t, {}) })).priced,
        false,
        'an empty table prices nothing',
    );
});

/** A read of the sessions' figures for `items`, counting its pauses by step. */
async function chunkedRead(
    t: Parameters<typeof tempDir>[0],
    threads: FixtureThread[],
    sessions: Parameters<typeof claudeHome>[1],
    items: string[][],
) {
    const home = tempDir(t, 'lar-home-');

    claudeHome(t, sessions, join(home, '.claude'));

    const db = statsDb(t, threads);
    const previous = process.env.T3_STATE_DB;

    process.env.T3_STATE_DB = db;

    try {
        const { rows, sessions: inputs } = await protocolStatsInputs();
        const trace: ReadTrace = createReadTrace(async () => {});
        const stats = await itemStats({ db, ...NOWHERE, home }, rows, NOW, { sessions: inputs, items, trace });

        return { stats, trace, home };
    } finally {
        if (previous === undefined) delete process.env.T3_STATE_DB;
        else process.env.T3_STATE_DB = previous;
    }
}

const ROOT_TURN = { startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z' };
const counted = (id: string, createdAt = '2026-10-20T08:00:00Z'): FixtureThread => ({
    id,
    sessions: [{ session: `session-${id}`, createdAt }],
    turns: [{ ...ROOT_TURN, id: `turn-${id}` }],
});

test('dedup yields in chunks of a bounded size, and its first copy still wins across them', async (t) => {
    const records = DEDUP_RECORDS_PER_CHUNK * 3;
    // One message opens both sessions, so it counts for the earlier thread only, whichever chunk reaches it.
    const shared = assistant('shared', 0, 0, 0, 1000);
    const lines = (name: string, count: number) =>
        Array.from({ length: count }, (_, i) => assistant(`${name}-${i}`, 0, 0, 0, 1));
    const { stats, trace } = await chunkedRead(
        t,
        [counted('a'), counted('b', '2026-10-20T08:30:00Z')],
        {
            'session-a': { main: [shared, ...lines('a', records / 2)] },
            'session-b': { main: [shared, ...lines('b', records / 2)] },
        },
        [['a'], ['b']],
    );

    assert.equal(trace.steps.dedup.pauses, 3);
    assert.equal(stats(['a'])?.tokens, 1000 + records / 2);
    assert.equal(stats(['b'])?.tokens, records / 2, 'the shared record counts once, for the earliest thread');
});
