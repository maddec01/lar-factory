import { beforeEach, test, vi } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assistant, claudeHome, statsDb, tempDir } from '../../test/stats-db.ts';
import { protocolStatsInputs as fixtureInputs, protocolThreadReads as fixtureReads } from '../../test/execution-observations.ts';
import * as statsModule from '../stats/item-stats.ts';
import * as transcripts from '../stats/transcript-usage.ts';
import * as execution from './item-execution.ts';
import type { T3Reads } from './t3-reads.ts';
import { createUsageCatchUp, type UsageCatchUpOptions } from './usage-catch-up.ts';

vi.spyOn(execution, 'protocolStatsInputs').mockImplementation(() => fixtureInputs());
const threadReads = vi.spyOn(execution, 'protocolThreadReads').mockImplementation((ids) => fixtureReads(ids));
beforeEach(() => threadReads.mockImplementation((ids) => fixtureReads(ids)));

const turn = { id: 'a1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z' };
const thread = (id: string, read?: 'never' | 'failed') => ({ id, ...read && { read }, sessions: [`session-${id}`], turns: [{ ...turn, id: `turn-${id}` }] });

/** A catch-up over T3's fixture threads, with its stats reads and log lines, whose first read settles when `state.settled` says. */
function catchUp(t: Parameters<typeof tempDir>[0] & Parameters<typeof statsDb>[0], threads: Parameters<typeof statsDb>[1], ids: string[], options: Partial<UsageCatchUpOptions> = {}) {
  const home = tempDir(t, 'lar-home-');
  claudeHome(t, Object.fromEntries(threads.map(({ id }) => [`session-${id}`, { main: [assistant(`m-${id}`, 0, 0, 0, 7)] }])), join(home, '.claude'));
  const db = statsDb(t, threads);
  vi.stubEnv('T3_STATE_DB', db);
  t.onTestFinished(() => { vi.unstubAllEnvs(); });
  const state = { settled: false, since: Infinity, published: [] as T3Reads[], logged: [] as string[], caughtUp: 0 };
  const sources = { db, home, settings: join(home, 'settings.json'), rates: join(home, 'rates.json') };
  return { state, db, sources, catchUp: createUsageCatchUp({ sources, threadIds: () => ids, settled: () => state.settled, sinceStatsRead: () => state.since, paceMs: () => 5_000, quietMs: 30_000,
    publish: (reads) => { state.published.push(reads); state.since = 0; }, caughtUp: () => { state.caughtUp++; }, timed: (step) => state.logged.push(step), ...options }) };
}

test('no stats read parses a cold transcript: a warm of the threads read so far runs first', async (t) => {
  const { catchUp: usage, sources } = catchUp(t, [thread('a')], ['a']);
  const read = vi.spyOn(statsModule, 'itemStats');
  t.onTestFinished(() => read.mockRestore());
  const misses: number[] = [];
  read.mockImplementationOnce((db, rows, statsSources, now, sessions) => {
    misses.push(statsModule.transcriptsToRead(db, sources, sessions).length);
    read.mockRestore();
    return statsModule.itemStats(db, rows, statsSources, now, sessions);
  });
  await usage.advance();
  assert.deepEqual(misses, [0], 'the warm left nothing for the stats read to read afresh');
});

test('warmup waits for an item with a thread or the settled first read', async (t) => {
  const { catchUp: usage, state } = catchUp(t, [], []);
  await usage.advance();
  assert.deepEqual(state.logged, []);
  state.settled = true;
  await usage.advance();
  assert.deepEqual(state.logged, ['warmup started', 'thread reads complete (read 0, failed 0, total 0)', 'every item settled']);
  assert.equal(state.caughtUp, 1, 'and it catches up with no thread to wait for');
  assert.equal(state.published.length, 0);
});

test('stats reads run when reads land, at the catch-up pace, and wait for no thread that failed', async (t) => {
  const { catchUp: usage, state, db } = catchUp(t, [thread('a'), thread('b', 'never'), thread('c', 'failed')], ['a', 'b', 'c']);
  assert.equal(usage.active(['a']), true, 'nothing warmed yet');
  await usage.advance();
  assert.equal(state.published.length, 1);
  assert.equal(usage.active(['a', 'c']), false, 'a failed thread holds up nothing');
  assert.equal(usage.active(['a', 'b']), true, 'a thread not read yet does');
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
  assert.equal(usage.active(['a', 'b', 'c']), false, 'the normal pace is back');
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
  threadReads.mockImplementation(() => ({ reads: new Map([['a', 'current'], ['b', 'failed']]), observed: new Set(['a']), demand() {} }));
  assert.equal(usage.active(ids), true, 'b was never covered');
  state.since = 5_000;
  await usage.advance();
  assert.equal(usage.active(ids), false, 'a failed read with no observation has no transcript to warm');
  threadReads.mockImplementation(() => ({ reads: new Map([['a', 'current'], ['b', 'current']]), observed: new Set(['a', 'b']), demand() {} }));
  assert.equal(usage.active(ids), true, 'its success names transcripts no warm read');
  state.since = 5_000;
  await usage.advance();
  assert.equal(state.published.length, 3);
  assert.equal(usage.active(ids), false);
  assert.equal(state.caughtUp, 1, 'catching up logs and writes once');
});

/** Holds each warm until the test releases it, counting those running at once. */
function heldWarms(t: Parameters<typeof tempDir>[0]) {
  const held = { running: 0, peak: 0, calls: 0, release: [] as (() => void)[] };
  const warm = vi.spyOn(transcripts, 'warmTranscripts').mockImplementation(() => new Promise((resolve) => {
    held.calls++;
    held.peak = Math.max(held.peak, ++held.running);
    held.release.push(() => { held.running--; resolve(0); });
  }));
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
  assert.equal(usage.active(['a']), true, 'the stats reads of other paths wait for it');
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
  assert.equal(held.calls, 2, 'five triggers made one follow-up, and c, with no trigger during that run, waits for the next tick');
  assert.equal(state.published.length, 2);
  assert.equal(usage.active(ids), true);
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
  threadReads.mockImplementation(() => ({ reads: new Map([['a', 'current'], ['b', 'failed'], ['c', 'never']]), observed: new Set(['a']), demand() { demands++; } }));
  for (let i = 0; i < 50; i++) await usage.advance();
  assert.equal(state.published.length, 1, 'a failure that lands once needs one stats read, however often the board ticks');
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
  assert.equal(usage.active(ids), true);
  await usage.advance();
  assert.equal(state.published.length, 2);
});

test('an unreadable database reports at once, holds up no settling, and its recovery still warms first', async (t) => {
  const { state, sources } = catchUp(t, [thread('a')], ['a']);
  const missing = createUsageCatchUp({ sources: { ...sources, db: join(tempDir(t, 'lar-gone-'), 'gone.sqlite') }, threadIds: () => ['a'], settled: () => true, sinceStatsRead: () => state.since, paceMs: () => 30_000, quietMs: 30_000,
    publish: (reads) => { state.published.push(reads); state.since = 0; }, caughtUp: () => { state.caughtUp++; }, timed: () => {} });
  await missing.advance();
  assert.equal(state.published[0]?.statsUnavailable, true);
  assert.equal(state.caughtUp, 1);
  assert.equal(missing.active(['a']), true, 'no warm covered it, so the next read warms first');
  state.since = 29_999;
  await missing.advance();
  assert.equal(state.published.length, 1, 'recovery waits for the normal pace');
});
