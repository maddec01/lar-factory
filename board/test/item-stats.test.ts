import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadItemStats } from '../src/item-stats.ts';
import type { ItemStatsReader, StatsSources } from '../src/item-stats.ts';
import { assistant, claudeHome, statsDb, t3Settings, tempDir } from './stats-db.ts';
import type { FixtureThread } from './stats-db.ts';

/** A home folder and settings that don't exist, so tests never read real transcripts. */
const NOWHERE = { settings: join(tmpdir(), 'no-such-dir', 'settings.json'), home: join(tmpdir(), 'no-such-dir', 'home') };

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
    { id: 'child', rootThreadId: 'root', messages: [`$mux-work ${REPO}#72`], turns: [turn('b')] },
    { id: 'stranger', rootThreadId: 'elsewhere', turns: [turn('c')] },
  ]));
  assert.equal(stats(REPO, 60)?.agentMs, 20 * MIN);
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
