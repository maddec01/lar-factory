import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadItemStats } from '../src/item-stats.ts';
import type { ItemStatsReader } from '../src/item-stats.ts';
import { statsDb } from './stats-db.ts';
import type { FixtureThread } from './stats-db.ts';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const REPO = 'maddec01/mux-factory';
const MIN = 60_000;

/** A finished ten-minute turn with the given tokens. */
function turn(id: string, input = 100, cached = 60, output = 10, usageStatus = 'complete') {
  return { id, startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z',
    usage: { inputTokens: input, cachedInputTokens: cached, outputTokens: output, usageStatus } };
}

function reader(path: string): ItemStatsReader {
  const stats = loadItemStats(path, NOW);
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
  assert.equal(loadItemStats(join(tmpdir(), 'no-such-dir', 'statev2.sqlite'), NOW), null);
  const changed = statsDb(t, [{ id: 'a', messages: [`$mux-work ${REPO}#1`] }]);
  const db = new DatabaseSync(changed);
  db.exec('ALTER TABLE orchestration_v2_projection_provider_turns RENAME COLUMN started_at TO began_at');
  db.close();
  assert.equal(loadItemStats(changed, NOW), 'unavailable');
});
