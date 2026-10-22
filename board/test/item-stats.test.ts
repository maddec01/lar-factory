import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadItemStats } from '../src/item-stats.ts';
import type { ItemStatsReader, StatsSources } from '../src/item-stats.ts';
import { assistant, claudeHome, codexHome, codexSession, codexTokens, statsDb, t3Settings, tempDir, usageRates } from './stats-db.ts';
import type { FixtureThread } from './stats-db.ts';

/** A home folder, settings and price table that don't exist, so tests never read real transcripts. */
const NOWHERE = {
  settings: join(tmpdir(), 'no-such-dir', 'settings.json'),
  rates: join(tmpdir(), 'no-such-dir', 'usage-model-rates.json'),
  home: join(tmpdir(), 'no-such-dir', 'home'),
};

const NOW = Date.parse('2026-10-20T12:00:00Z');
const REPO = 'maddec01/mux-factory';
const MIN = 60_000;

/** A finished ten-minute turn. */
function turn(id: string) {
  return { id, startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z' };
}

function reader(db: string, sources: Partial<StatsSources> = {}): ItemStatsReader {
  const stats = loadItemStats({ db, ...NOWHERE, ...sources }, NOW);
  assert.equal(typeof stats, 'function', `expected a reader, got ${String(stats)}`);
  return stats as ItemStatsReader;
}

test('an item\'s threads are the roots whose first user message names it, in any of the three forms', (t) => {
  const threads: FixtureThread[] = [
    { id: 'start', messages: [`#60 Show new item stats.\n$mux-work ${REPO}#60`, `Build ${REPO}#61`], turns: [turn('a')] },
    { id: 'handoff', messages: [`Carry on with the review.\n/mux-work ${REPO}#60 please`], turns: [turn('b')] },
    { id: 'build', messages: [`Build ${REPO}#60. Read builder.md and follow it.`], turns: [turn('c')] },
    // Named only in a later message, in the middle of a line, or by another repo.
    { id: 'later', messages: ['hello', `$mux-work ${REPO}#60`], turns: [turn('d')] },
    { id: 'inline', messages: [`please Build ${REPO}#60`], turns: [turn('e')] },
    { id: 'other-repo', messages: [`$mux-work maddec01/mux-server#60`], turns: [turn('f')] },
  ];
  const stats = reader(statsDb(t, threads));
  assert.deepEqual(stats(REPO, 60), { agentMs: 30 * MIN, tokens: 0 }, 'T3\'s own token counts are not read');
  assert.equal(stats(REPO, 61), null, 'only the first user message counts');
  assert.equal(stats('maddec01/mux-server', 60)?.agentMs, 10 * MIN);
});

test('the number must match exactly, and titles are never used', (t) => {
  const stats = reader(statsDb(t, [
    { id: 'build-59', title: 'slice #68', messages: [`Build ${REPO}#59`], turns: [turn('a')] },
    { id: 'issue-60', title: '#6 fix', messages: [`$mux-work ${REPO}#60`], turns: [turn('b')] },
  ]));
  assert.equal(stats(REPO, 68), null);
  assert.equal(stats(REPO, 6), null);
  assert.equal(stats(REPO, 60)?.agentMs, 10 * MIN);
  assert.equal(stats(REPO, 59)?.agentMs, 10 * MIN);
});

test('child threads count through their lineage root, even when their own first message names another issue', (t) => {
  const stats = reader(statsDb(t, [
    { id: 'root', messages: [`Build ${REPO}#60`], turns: [turn('a')] },
    { id: 'child', rootThreadId: 'root', messages: [`$mux-work ${REPO}#72`],
      turns: [{ id: 'b', startedAt: '2026-10-20T09:20:00Z', completedAt: '2026-10-20T09:30:00Z' }] },
    { id: 'stranger', rootThreadId: 'elsewhere', turns: [turn('c')] },
  ]));
  assert.equal(stats(REPO, 60)?.agentMs, 20 * MIN);
  assert.equal(stats(REPO, 72), null, 'a child is not a root of its own');
});

/** A ten-minute root turn naming issue `n`, from 09:00. */
function root(n: number): FixtureThread {
  return { id: `root-${n}`, messages: [`Build ${REPO}#${n}`], turns: [turn(`root-${n}`)] };
}

/** A turn-less subagent child of `root(n)` running from `start` to `end` (HH:MM on the test day). */
function subagent(id: string, n: number, start: string, end: string | null, extra: Partial<FixtureThread> = {}): FixtureThread {
  const at = (hm: string) => `2026-10-20T${hm}:00Z`;
  return { id, rootThreadId: `root-${n}`, subagent: { startedAt: at(start), completedAt: end && at(end) }, ...extra };
}

test('a subagent adds the part of its run outside its parent\'s turns, and parallel siblings add up', (t) => {
  const stats = reader(statsDb(t, [
    root(1), subagent('background', 1, '09:10', '09:25'),
    root(2), subagent('foreground', 2, '09:02', '09:08'),
    // A Codex-style child: its own turns count, not its run, which T3 repeats.
    root(3), { id: 'codex', rootThreadId: 'root-3', subagent: [
      { startedAt: '2026-10-20T09:01:00Z', completedAt: '2026-10-20T09:30:00Z' },
      { startedAt: '2026-10-20T09:01:00Z', completedAt: '2026-10-20T09:30:00Z' },
    ], turns: [
      { id: 'c1', startedAt: '2026-10-20T09:01:00Z', completedAt: '2026-10-20T09:04:00Z' },
      { id: 'c2', startedAt: '2026-10-20T09:05:00Z', completedAt: '2026-10-20T09:09:00Z' },
    ] },
    root(4), subagent('left', 4, '09:10', '09:25'), subagent('right', 4, '09:10', '09:25'),
    // One child's repeated runs are merged before counting.
    root(5), { id: 'repeated', rootThreadId: 'root-5', subagent: [
      { startedAt: '2026-10-20T09:10:00Z', completedAt: '2026-10-20T09:20:00Z' },
      { startedAt: '2026-10-20T09:15:00Z', completedAt: '2026-10-20T09:25:00Z' },
    ] },
  ]));
  assert.equal(stats(REPO, 1)?.agentMs, 25 * MIN);
  assert.equal(stats(REPO, 2)?.agentMs, 10 * MIN, 'a parent waiting on its subagent counts once');
  assert.equal(stats(REPO, 3)?.agentMs, 10 * MIN, 'a child working inside its parent\'s turn adds nothing');
  assert.equal(stats(REPO, 4)?.agentMs, 40 * MIN);
  assert.equal(stats(REPO, 5)?.agentMs, 25 * MIN);
});

test('a running subagent counts up to its latest message, never its updated time, and 0 before its first', (t) => {
  const stats = reader(statsDb(t, [
    root(1), subagent('replied', 1, '09:10', null, { repliedAt: '2026-10-20T09:18:00Z' }),
    root(2), subagent('silent', 2, '09:10', null),
  ]));
  assert.equal(stats(REPO, 1)?.agentMs, 18 * MIN);
  assert.equal(stats(REPO, 2)?.agentMs, 10 * MIN);
});

test('a subagent under a child task has its time taken out of that child\'s work, not the root\'s', (t) => {
  const stats = reader(statsDb(t, [
    root(1),
    { id: 'task', rootThreadId: 'root-1', turns: [{ id: 'task', startedAt: '2026-10-20T09:20:00Z', completedAt: '2026-10-20T09:40:00Z' }] },
    subagent('nested', 1, '09:30', '09:50', { parentThreadId: 'task' }),
  ]));
  assert.equal(stats(REPO, 1)?.agentMs, (10 + 20 + 10) * MIN);
});

test('agent time leaves out waits on Pedro inside a turn, and a running turn or wait counts up to now', (t) => {
  const stats = reader(statsDb(t, [
    { id: 'waits', messages: [`$mux-work ${REPO}#1`], turns: [
      { id: 't1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T10:00:00Z' },
    ] },
    { id: 'running', messages: [`$mux-work ${REPO}#2`], turns: [
      { id: 't2', startedAt: '2026-10-20T11:30:00Z', completedAt: null },
    ] },
    { id: 'parallel', messages: [`$mux-work ${REPO}#3`], turns: [turn('t3')] },
    { id: 'parallel-2', messages: [`$mux-work ${REPO}#3`], turns: [turn('t4')] },
  ], [
    // Two overlapping waits (09:10-09:30) and one past the turn's end (09:50-10:00 counted).
    { turnId: 't1', createdAt: '2026-10-20T09:10:00Z', resolvedAt: '2026-10-20T09:20:00Z' },
    { turnId: 't1', createdAt: '2026-10-20T09:15:00Z', resolvedAt: '2026-10-20T09:30:00Z' },
    { turnId: 't1', createdAt: '2026-10-20T09:50:00Z', resolvedAt: '2026-10-20T10:30:00Z' },
    // Still waiting on Pedro since 11:45.
    { turnId: 't2', createdAt: '2026-10-20T11:45:00Z', resolvedAt: null },
  ]));
  assert.equal(stats(REPO, 1)?.agentMs, 30 * MIN);
  assert.equal(stats(REPO, 2)?.agentMs, 15 * MIN);
  assert.equal(stats(REPO, 3)?.agentMs, 20 * MIN, 'parallel threads add up');
});

test('an open turn whose thread isn\'t running stops at the thread\'s latest activity, not now', (t) => {
  const stats = reader(statsDb(t, [
    // Its run failed at 09:00; the message stamps 08:00, the wait 09:05-09:20.
    { id: 'abandoned', messages: [`$mux-work ${REPO}#7`], turns: [
      { id: 'a1', startedAt: '2026-10-20T08:30:00Z', completedAt: '2026-10-20T08:40:00Z' },
      { id: 'a2', startedAt: '2026-10-20T09:00:00Z', completedAt: null, abandoned: true },
    ] },
    { id: 'abandoned-quiet', messages: [`$mux-work ${REPO}#8`], turns: [
      { id: 'b1', startedAt: '2026-10-20T09:00:00Z', completedAt: null, abandoned: true },
    ] },
  ], [{ turnId: 'a2', createdAt: '2026-10-20T09:05:00Z', resolvedAt: '2026-10-20T09:20:00Z' }]));
  assert.equal(stats(REPO, 7)?.agentMs, 10 * MIN + 5 * MIN, 'the open turn runs 09:00-09:20, less the 15-minute wait');
  assert.equal(stats(REPO, 8)?.agentMs, 0, 'nothing after the turn started');
});

test('a stale open turn on an active provider thread stops at the next turn\'s start, and only the latest counts to now', (t) => {
  const stats = reader(statsDb(t, [
    // A turn that failed at 09:00 and T3 never closed, then a turn running since 11:30 on the same provider thread.
    { id: 'retried', messages: [`$mux-work ${REPO}#9`], turns: [
      { id: 'r1', startedAt: '2026-10-20T09:00:00Z', completedAt: null, providerThread: 'claude' },
      { id: 'r2', startedAt: '2026-10-20T10:00:00Z', completedAt: '2026-10-20T10:10:00Z', providerThread: 'claude' },
      { id: 'r3', startedAt: '2026-10-20T11:30:00Z', completedAt: null, providerThread: 'claude' },
    ] },
  ]));
  assert.equal(stats(REPO, 9)?.agentMs, 60 * MIN + 10 * MIN + 30 * MIN, 'r1 runs 09:00-10:00, not to now');
});

test('a missing database gives no stats, and an unexpected schema gives unavailable', (t) => {
  assert.equal(loadItemStats({ db: join(tmpdir(), 'no-such-dir', 'statev2.sqlite'), ...NOWHERE }, NOW), null);
  const changed = statsDb(t, [{ id: 'a', messages: [`$mux-work ${REPO}#1`] }]);
  const db = new DatabaseSync(changed);
  db.exec('ALTER TABLE orchestration_v2_projection_provider_turns RENAME COLUMN started_at TO began_at');
  db.close();
  assert.equal(loadItemStats({ db: changed, ...NOWHERE }, NOW), 'unavailable');
});

test('tokens are T3\'s totals over each session\'s own and subagent transcripts, each message once', (t) => {
  const home = tempDir(t, 'mux-home-');
  claudeHome(t, {
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
  }, join(home, '.claude'));
  const stats = reader(statsDb(t, [
    // A thread with two provider threads: both sessions count.
    { id: 'build', messages: [`Build ${REPO}#60`], sessions: ['session-a1', 'session-a2'], turns: [turn('t1')] },
    { id: 'other', messages: [`$mux-work ${REPO}#61`], sessions: ['session-other'] },
    { id: 'plain', messages: [`$mux-work ${REPO}#62`], sessions: ['session-none'], turns: [turn('t2')] },
  ]), { home });
  assert.deepEqual(stats(REPO, 60), { agentMs: 10 * MIN, tokens: 6042 + 6101 + 15 + 101 });
  assert.equal(stats(REPO, 61)?.tokens, 198);
  assert.deepEqual(stats(REPO, 62), { agentMs: 10 * MIN, tokens: 0 }, 'no transcripts, no tokens');
});

test('each thread reads the transcripts under its own provider instance\'s Claude home, from T3\'s settings', (t) => {
  const home = tempDir(t, 'mux-home-');
  // The same session ID in both homes: only the thread's own instance counts.
  claudeHome(t, { shared: { main: [assistant('msg-work', 0, 0, 1000, 0)] } }, join(home, '.claude'));
  claudeHome(t, { shared: { main: [assistant('msg-personal', 0, 0, 20, 0)] } }, join(home, '.claude-personal'));
  const elsewhere = claudeHome(t, { 'session-x': { main: [assistant('msg-x', 0, 0, 3, 0)] } });
  const db = statsDb(t, [
    { id: 'work', messages: [`$mux-work ${REPO}#1`], sessions: [{ session: 'shared', instance: 'claudeAgent' }] },
    { id: 'personal', messages: [`$mux-work ${REPO}#2`], sessions: [{ session: 'shared', instance: 'claudeAgent_personal' }] },
    { id: 'absolute', messages: [`$mux-work ${REPO}#3`], sessions: [{ session: 'session-x', instance: 'claudeAgent_x' }] },
    { id: 'unknown', messages: [`$mux-work ${REPO}#4`], sessions: [{ session: 'shared', instance: 'claudeAgent_gone' }] },
    { id: 'codex', messages: [`$mux-work ${REPO}#5`], sessions: [{ session: 'shared', instance: 'codex', driver: 'codex' }] },
  ]);
  const settings = t3Settings(t, { claudeAgent_personal: '~/.claude-personal', claudeAgent: '', claudeAgent_x: elsewhere });
  const stats = reader(db, { settings, home });
  assert.deepEqual([1, 2, 3, 4, 5].map((n) => stats(REPO, n)?.tokens), [1000, 20, 3, 0, 0]);
  // Without readable settings only the built-in instance, at ~/.claude, is known.
  assert.deepEqual([1, 2].map((n) => reader(db, { home })(REPO, n)?.tokens), [1000, 0]);
});

test('an item totals its Claude and Codex threads, each Codex thread from its own instance\'s Codex home', (t) => {
  const home = tempDir(t, 'mux-home-');
  const build = '01a13627-9790-70d0-8342-58f71022e222';
  const child = '01a13628-c84a-7f33-9a04-c55eb4c75845';
  const other = '01a13628-ffd8-70c1-a4a8-67217b17f950';
  claudeHome(t, { 'session-claude': { main: [assistant('msg-1', 2, 1000, 5000, 40)] } }, join(home, '.claude'));
  codexHome(t, {
    [build]: [...codexSession(build), codexTokens('2026-10-20T09:01:00.000Z', 1000, 400, 50, [1000, 400, 50]),
      codexTokens('2026-10-20T09:02:00.000Z', 2000, 1500, 70, [3000, 1900, 120])],
    // A child thread's rollout opens with a copy of its parent's history, counted for the parent only.
    [child]: [...codexSession(child, 'gpt-5.6-sol', build), codexTokens('2026-10-20T09:00:00.000Z', 1000, 400, 50, [1000, 400, 50]),
      codexTokens('2026-10-20T09:05:00.000Z', 300, 0, 9, [1300, 400, 59])],
  }, join(home, '.codex'));
  const elsewhere = codexHome(t, { [other]: [...codexSession(other), codexTokens('2026-10-20T09:01:00.000Z', 7, 0, 1)] });
  const db = statsDb(t, [
    { id: 'build', messages: [`Build ${REPO}#60`], turns: [turn('t1')],
      sessions: ['session-claude', { session: build, instance: 'codex', driver: 'codex' }] },
    { id: 'child', rootThreadId: 'build', sessions: [{ session: child, instance: 'codex', driver: 'codex' }] },
    { id: 'other', messages: [`$mux-work ${REPO}#61`], sessions: [{ session: other, instance: 'codex_work', driver: 'codex' }] },
  ]);
  const settings = t3Settings(t, { codex_work: { driver: 'codex', homePath: elsewhere } });
  const stats = reader(db, { settings, home });
  assert.deepEqual(stats(REPO, 60), { agentMs: 10 * MIN, tokens: 6042 + 1050 + 2070 + 309 });
  assert.equal(stats(REPO, 61)?.tokens, 8);
});

test('a record forked threads share counts once, for the item whose thread produced it first', (t) => {
  const home = tempDir(t, 'mux-home-');
  claudeHome(t, {
    original: { main: [assistant('msg-1', 0, 0, 500, 0), assistant('msg-2', 0, 0, 60, 0)] },
    // A fork copies the original's records forward, then adds its own.
    fork: { main: [assistant('msg-1', 0, 0, 500, 0), assistant('msg-2', 0, 0, 60, 0), assistant('msg-3', 0, 0, 7, 0)] },
  }, join(home, '.claude'));
  const stats = reader(statsDb(t, [
    // Listed first, but created after the original.
    { id: 'forked', messages: [`$mux-work ${REPO}#61`], sessions: [{ session: 'fork', createdAt: '2026-10-20T10:00:00.000Z' }] },
    { id: 'first', messages: [`$mux-work ${REPO}#60`], sessions: [{ session: 'original', createdAt: '2026-10-20T09:00:00.000Z' }] },
  ]), { home });
  assert.equal(stats(REPO, 60)?.tokens, 560);
  assert.equal(stats(REPO, 61)?.tokens, 7);
});

test('missing or garbled transcripts leave tokens out, and never break the stats', (t) => {
  const home = tempDir(t, 'mux-home-');
  claudeHome(t, { 'session-a': { main: ['{not json', '"a string"', 'null', JSON.stringify({ type: 'assistant', message: { id: 'm' } })] } },
    join(home, '.claude'));
  const db = statsDb(t, [{ id: 'build', messages: [`Build ${REPO}#60`], sessions: ['session-a', '../escape'], turns: [turn('t1')] }]);
  const expected = { agentMs: 10 * MIN, tokens: 0 };
  assert.deepEqual(reader(db)(REPO, 60), expected);
  assert.deepEqual(reader(db, { home })(REPO, 60), expected);
});

const close = (actual: number | undefined, expected: number) =>
  assert.ok(actual !== undefined && Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('API cost is T3\'s price for the item\'s records, with the aliases and overrides in T3\'s settings', (t) => {
  const home = tempDir(t, 'mux-home-');
  claudeHome(t, {
    'session-a': { main: [
      assistant('m1', 1000, 2000, 10000, 500, 'claude-opus-4-1'),
      // No cache rates in the table: cached tokens cost the input rate.
      assistant('m2', 1000, 1000, 1000, 0, 'claude-fable-5-1[1m]'),
      // Aliased to a model only the user's override prices.
      assistant('m3', 1000, 0, 0, 100, 'internal-model'),
      // The provider's own cost goes ahead of the table.
      { ...assistant('m4', 9999, 0, 0, 9999, 'claude-opus-4-1'), costUSD: 0.25 },
      assistant('m5', 9999, 0, 0, 9999, 'mystery-model'),
    ] },
    'session-b': { main: [assistant('m6', 1000, 0, 0, 0, 'mystery-model'), assistant('m7', 1000, 0, 0, 0, 'opus')] },
  }, join(home, '.claude'));
  const db = statsDb(t, [
    { id: 'priced', messages: [`$mux-work ${REPO}#60`], sessions: ['session-a'] },
    { id: 'unpriced', messages: [`$mux-work ${REPO}#61`], sessions: ['session-b'] },
  ]);
  const settings = t3Settings(t, {}, {
    usageModelAliases: { 'internal-model': 'my-proxy' },
    usagePriceOverrides: { 'my-proxy': { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 }, broken: { inputCostPerMillionTokens: -1 } },
  });
  const rates = usageRates(t, {
    'claude-opus-4-1': { input_cost_per_token: 1.5e-5, output_cost_per_token: 7.5e-5, cache_read_input_token_cost: 1.5e-6, cache_creation_input_token_cost: 1.875e-5 },
    'claude-fable-5-1': { input_cost_per_token: 1e-5, output_cost_per_token: 5e-5 },
  });
  const stats = reader(db, { home, settings, rates });
  close(stats(REPO, 60)?.costUsd, 0.105 + 0.03 + 0.0028 + 0.25);
  assert.deepEqual(stats(REPO, 61), { agentMs: 0, tokens: 2000 }, 'nothing priced, no cost');
  // Without T3's price table there is no cost, and the rest of the stats stand.
  assert.deepEqual(reader(db, { home, settings })(REPO, 60), { agentMs: 0, tokens: 13500 + 3000 + 1100 + 9999 * 4 });
  assert.equal(stats.priced, true);
  assert.equal(reader(db, { home, settings }).priced, false, 'the server logs when pricing goes and comes back');
  assert.equal(reader(db, { home, settings, rates: usageRates(t, {}) }).priced, false, 'an empty table prices nothing');
});

test('a Codex record whose rollout has no speed tier takes the one its turn started with in T3\'s history', (t) => {
  const home = tempDir(t, 'mux-home-');
  const sessions = ['01a13627-9790-70d0-8342-58f71022e001', '01a13627-9790-70d0-8342-58f71022e002', '01a13627-9790-70d0-8342-58f71022e003'];
  const rollout = (id: string, turnId: string) => [
    { type: 'session_meta', timestamp: '2026-10-20T09:00:00.000Z', payload: { type: 'session_meta', id, model_provider: 'openai' } },
    { type: 'turn_context', timestamp: '2026-10-20T09:00:00.000Z', payload: { type: 'turn_context', model: 'gpt-6-astra', turn_id: turnId } },
    codexTokens('2026-10-20T09:01:00.000Z', 1000, 0, 100, [1000, 0, 100]),
  ];
  codexHome(t, Object.fromEntries(sessions.map((id, i) => [id, rollout(id, `turn-${i}`)])), join(home, '.codex'));
  const selection = (model: string, options: object[]) => ({ instanceId: 'codex', model, options });
  const db = statsDb(t, [
    [selection('gpt-6-astra', [{ id: 'serviceTier', value: 'priority' }])],
    [selection('gpt-6-astra', [{ id: 'fastMode', value: true }])],
    // A selection for another model can't tell this record's tier.
    [selection('gpt-6-sol', [{ id: 'serviceTier', value: 'priority' }])],
  ].map(([sel], i) => ({
    id: `codex-${i}`, messages: [`$mux-work ${REPO}#${70 + i}`], sessions: [{ session: sessions[i]!, instance: 'codex', driver: 'codex' }],
    turns: [{ ...turn(`t${i}`), codex: { session: sessions[i]!, nativeTurn: `turn-${i}`, selection: sel! } }],
  })));
  const rates = usageRates(t, { 'gpt-6-astra': {
    input_cost_per_token: 1e-5, output_cost_per_token: 5e-5, input_cost_per_token_priority: 2e-5, output_cost_per_token_priority: 1e-4,
  } });
  const stats = reader(db, { home, rates });
  close(stats(REPO, 70)?.costUsd, 0.03);
  close(stats(REPO, 71)?.costUsd, 0.03);
  close(stats(REPO, 72)?.costUsd, 0.015);
});
