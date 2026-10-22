import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadItemStats } from '../src/item-stats.ts';
import type { ItemStatsReader } from '../src/item-stats.ts';
import { assistant, statsDb, transcriptsDir } from './stats-db.ts';
import type { FixtureThread } from './stats-db.ts';

/** A transcripts root that doesn't exist, so tests never read real transcripts. */
const NO_TRANSCRIPTS = join(tmpdir(), 'no-such-dir', 'projects');

const NOW = Date.parse('2026-10-20T12:00:00Z');
const REPO = 'maddec01/mux-factory';
const MIN = 60_000;

/** A finished ten-minute turn with the given tokens. */
function turn(id: string, input = 100, cached = 60, output = 10, usageStatus = 'complete') {
  return { id, startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z',
    usage: { inputTokens: input, cachedInputTokens: cached, outputTokens: output, usageStatus } };
}

function reader(path: string, transcripts = NO_TRANSCRIPTS): ItemStatsReader {
  const stats = loadItemStats(path, transcripts, NOW);
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
  assert.deepEqual(stats(REPO, 60)?.tokens, { input: 300, cached: 180, output: 30, lowerBound: false });
  assert.equal(stats(REPO, 60)?.agentMs, 30 * MIN);
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
    { id: 'child', rootThreadId: 'root', messages: [`$mux-work ${REPO}#72`], turns: [turn('b', 1000, 0, 5)] },
    { id: 'stranger', rootThreadId: 'elsewhere', turns: [turn('c')] },
  ]));
  assert.deepEqual(stats(REPO, 60), { agentMs: 20 * MIN, tokens: { input: 1100, cached: 60, output: 15, lowerBound: false } });
  assert.equal(stats(REPO, 72), null, 'a child is not a root of its own');
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

test('tokens are a lower bound when any turn\'s usage is partial, unavailable or missing', (t) => {
  const stats = reader(statsDb(t, [
    { id: 'partial', messages: [`$mux-work ${REPO}#1`], turns: [turn('a'), turn('b', 50, 0, 5, 'partial')] },
    { id: 'unavailable', messages: [`$mux-work ${REPO}#2`], turns: [turn('c', 0, 0, 0, 'unavailable')] },
    { id: 'missing', messages: [`$mux-work ${REPO}#3`], turns: [{ id: 'd', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:01:00Z' }] },
  ]));
  assert.deepEqual(stats(REPO, 1)?.tokens, { input: 150, cached: 60, output: 15, lowerBound: true });
  assert.equal(stats(REPO, 2)?.tokens.lowerBound, true);
  assert.deepEqual(stats(REPO, 3)?.tokens, { input: 0, cached: 0, output: 0, lowerBound: true });
});

test('a missing database gives no stats, and an unexpected schema gives unavailable', (t) => {
  assert.equal(loadItemStats(join(tmpdir(), 'no-such-dir', 'statev2.sqlite'), NO_TRANSCRIPTS, NOW), null);
  const changed = statsDb(t, [{ id: 'a', messages: [`$mux-work ${REPO}#1`] }]);
  const db = new DatabaseSync(changed);
  db.exec('ALTER TABLE orchestration_v2_projection_provider_turns RENAME COLUMN started_at TO began_at');
  db.close();
  assert.equal(loadItemStats(changed, NO_TRANSCRIPTS, NOW), 'unavailable');
});

test('Claude subagent tokens come from the subagent transcripts of every session of the item\'s threads, each message once', (t) => {
  const transcripts = transcriptsDir(t, {
    // A thread with two provider threads: both sessions count.
    'session-a1': {
      a1: [
        { type: 'user', message: { role: 'user', content: 'Review the branch' } },
        // Transcripts repeat a message's record; the last copy has its final usage.
        assistant('msg-1', 2, 1000, 5000, 40),
        assistant('msg-1', 2, 1000, 5000, 200),
        assistant('msg-2', 1, 0, 6000, 100),
      ],
      a2: [assistant('msg-3', 10, 0, 0, 5)],
    },
    'session-a2': { a3: [assistant('msg-4', 0, 100, 0, 1)] },
    'session-child': { a4: [assistant('msg-5', 3, 0, 300, 2)] },
    'session-other': { a5: [assistant('msg-6', 99, 0, 0, 99)] },
  });
  const stats = reader(statsDb(t, [
    { id: 'build', messages: [`Build ${REPO}#60`], sessions: ['session-a1', 'session-a2'], turns: [turn('t1')] },
    { id: 'child', rootThreadId: 'build', sessions: ['session-child'] },
    { id: 'other', messages: [`$mux-work ${REPO}#61`], sessions: ['session-other'] },
    { id: 'plain', messages: [`$mux-work ${REPO}#62`], sessions: ['session-none'], turns: [turn('t2')] },
  ]), transcripts);
  assert.deepEqual(stats(REPO, 60), {
    agentMs: 10 * MIN,
    tokens: { input: 100, cached: 60, output: 10, lowerBound: false },
    subagentTokens: { input: 6002 + 6001 + 10 + 100 + 303, cached: 11300, output: 200 + 100 + 5 + 1 + 2 },
  });
  assert.deepEqual(stats(REPO, 61)?.subagentTokens, { input: 99, cached: 0, output: 99 });
  assert.equal(stats(REPO, 62)?.subagentTokens, undefined, 'no figure without subagent transcripts');
});

test('turns T3 already counts are not added again: app-owned and Codex children count only through their turns', (t) => {
  const transcripts = transcriptsDir(t,
    { 'session-root': { native: [assistant('msg-native', 0, 0, 700, 7)] } },
    // An app-owned Claude child's own transcript: T3 counts it in its turns.
    { 'session-app-owned': [assistant('msg-app', 0, 0, 5000, 50)], 'session-root': [assistant('msg-root', 0, 0, 9000, 90)] });
  const stats = reader(statsDb(t, [
    { id: 'root', messages: [`Build ${REPO}#60`], sessions: ['session-root'], turns: [turn('t1')] },
    { id: 'app-owned', rootThreadId: 'root', sessions: ['session-app-owned'], turns: [turn('t2', 5000, 5000, 50)] },
    { id: 'codex', rootThreadId: 'root', turns: [turn('t3', 300, 0, 3)] },
  ]), transcripts);
  assert.deepEqual(stats(REPO, 60), {
    agentMs: 30 * MIN,
    tokens: { input: 5400, cached: 5060, output: 63, lowerBound: false },
    subagentTokens: { input: 700, cached: 700, output: 7 },
  });
});

test('missing or unreadable transcripts leave the subagent figure out, and never break the stats', (t) => {
  const threads: FixtureThread[] = [{ id: 'build', messages: [`Build ${REPO}#60`], sessions: ['session-a', '../escape'], turns: [turn('t1')] }];
  const expected = { agentMs: 10 * MIN, tokens: { input: 100, cached: 60, output: 10, lowerBound: false } };
  assert.deepEqual(reader(statsDb(t, threads))(REPO, 60), expected);
  const garbled = transcriptsDir(t, { 'session-a': { a1: ['{not json', '"a string"', 'null', JSON.stringify({ type: 'assistant', message: { id: 'm' } })] } });
  assert.deepEqual(reader(statsDb(t, threads), garbled)(REPO, 60), { ...expected, subagentTokens: { input: 0, cached: 0, output: 0 } });
  // A database from before provider threads were recorded still gives T3 stats.
  const old = statsDb(t, threads);
  const db = new DatabaseSync(old);
  db.exec('DROP TABLE orchestration_v2_projection_provider_threads');
  db.close();
  assert.deepEqual(reader(old, garbled)(REPO, 60), expected);
});
