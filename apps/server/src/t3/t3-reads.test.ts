import { test, vi } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadT3Reads, warmT3Stats } from './t3-reads.ts';
import { assistant, claudeHome, statsDb, tempDir } from '../../test/stats-db.ts';

import * as statsModule from '../stats/item-stats.ts';
import * as execution from './item-execution.ts';
vi.spyOn(execution, 'protocolStatsInputs').mockImplementation(() => fixtureInputs());
import { protocolStatsInputs as fixtureInputs } from '../../test/execution-observations.ts';

/** A home folder, settings and price table that don't exist, so tests never read real transcripts. */
const NOWHERE = {
  settings: join(tmpdir(), 'no-such-dir', 'settings.json'),
  rates: join(tmpdir(), 'no-such-dir', 'usage-model-rates.json'),
  home: join(tmpdir(), 'no-such-dir', 'home'),
};
const NOW = Date.parse('2026-10-20T12:00:00Z');
const REPO = 'maddec01/lar-factory';
/** A lookup's result once it's read, failing the test when there was none or it was unavailable. */
function found<T>(value: T | 'unavailable' | undefined): T {
  assert.ok(value !== undefined && value !== 'unavailable', `expected a read, got ${value}`);
  return value;
}
const turn = { id: 'a1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z' };

test("one read of the database gives each item its record's threads' stats, and undefined for an item with none", (t) => {
  const db = statsDb(t, [{ id: 'a', title: 'Shape #1', messages: [`$lar-work ${REPO}#1`], turns: [turn] }]);
  vi.stubEnv('T3_STATE_DB', db);
  t.onTestFinished(() => { vi.unstubAllEnvs(); });
  const reads = loadT3Reads({ db, ...NOWHERE }, NOW);
  assert.equal(found(reads.stats(['a'])).agentMs, 10 * 60_000);
  assert.equal(reads.stats(['gone']), undefined);
  assert.deepEqual([reads.statsUnavailable, reads.priced], [false, false], 'no rate table, so nothing is priced');
});

test('a missing or unreadable usage database reports unavailable stats', (t) => {
  const missing = loadT3Reads({ db: join(tmpdir(), 'no-such-dir', 'statev2.sqlite'), ...NOWHERE }, NOW);
  assert.deepEqual([missing.usage(['a']), missing.usage([])], ['failed', 'current']);
  assert.deepEqual([missing.stats(['a']), missing.statsUnavailable, missing.priced], ['unavailable', true, null]);
  assert.equal(missing.stats([]), undefined, 'an item with no threads has nothing a failed read lost');
  const changed = statsDb(t, [{ id: 'a', messages: [`$lar-work ${REPO}#1`] }]);
  vi.stubEnv('T3_STATE_DB', changed + '.unavailable');
  t.onTestFinished(() => { vi.unstubAllEnvs(); });
  const broken = loadT3Reads({ db: changed, ...NOWHERE }, NOW);
  assert.deepEqual([broken.stats(['a']), broken.statsUnavailable, broken.priced], ['unavailable', true, null]);
  assert.equal(broken.stats([]), undefined);
});

test('a stats read that fails reports unavailable stats', (t) => {
  const db = statsDb(t, [{ id: 'a', title: 'Shape #1', messages: [`$lar-work ${REPO}#1`], turns: [turn] }]);
  const failedUsage = vi.spyOn(statsModule, 'itemStats').mockImplementationOnce(() => { throw Error('Usage unavailable'); });
  t.onTestFinished(() => failedUsage.mockRestore());
  vi.stubEnv('T3_STATE_DB', db);
  t.onTestFinished(() => { vi.unstubAllEnvs(); });
  const reads = loadT3Reads({ db, ...NOWHERE }, NOW);
  assert.equal(reads.stats(['a']), 'unavailable');
  assert.equal(reads.statsUnavailable, true);
});

test('a failed thread fails only the items whose family holds it, and an item with no threads is never unavailable', (t) => {
  const db = statsDb(t, [
    { id: 'a', messages: [`$lar-work ${REPO}#1`], turns: [turn] },
    { id: 'b', read: 'failed', messages: [`$lar-work ${REPO}#2`], turns: [{ ...turn, id: 'b1' }] },
    { id: 'b-child', rootThreadId: 'b', turns: [] },
    { id: 'c', read: 'failed', rootThreadId: 'd', turns: [] },
    { id: 'd', messages: [`$lar-work ${REPO}#3`], turns: [{ ...turn, id: 'd1' }] },
  ]);
  vi.stubEnv('T3_STATE_DB', db);
  t.onTestFinished(() => { vi.unstubAllEnvs(); });
  const reads = loadT3Reads({ db, ...NOWHERE }, NOW);
  assert.equal(found(reads.stats(['a'])).agentMs, 10 * 60_000);
  assert.equal(reads.usage(['a']), 'current');
  for (const family of ['b', 'd']) {
    assert.equal(reads.stats([family]), 'unavailable');
    assert.equal(reads.usage([family]), 'failed');
  }
  assert.equal(reads.stats([]), undefined);
  assert.equal(reads.usage([]), 'current');
  assert.equal(reads.statsUnavailable, false, 'the reader works, so usageRead stays readable');
  assert.equal(reads.allObserved, true, 'each failed thread has a retained observation');
});

test('an item with a thread never read loads with no figures, and the board stays provisional', (t) => {
  const db = statsDb(t, [
    { id: 'a', messages: [`$lar-work ${REPO}#1`], turns: [turn] },
    { id: 'b', messages: [`$lar-work ${REPO}#2`], turns: [{ ...turn, id: 'b1' }] },
    { id: 'b-child', read: 'never', rootThreadId: 'b', turns: [] },
  ]);
  vi.stubEnv('T3_STATE_DB', db);
  t.onTestFinished(() => { vi.unstubAllEnvs(); });
  const reads = loadT3Reads({ db, ...NOWHERE }, NOW);
  assert.equal(reads.usage(['b']), 'loading');
  assert.equal(reads.stats(['b']), undefined, 'never figures from part of a family');
  assert.equal(reads.usage(['a']), 'current');
  assert.equal(found(reads.stats(['a'])).agentMs, 10 * 60_000);
  assert.equal(reads.allObserved, false);
});

test('T3 running with its thread list unread is loading, with no read reported', (t) => {
  const db = statsDb(t, [{ id: 'a', messages: [`$lar-work ${REPO}#1`], turns: [turn] }]);
  const unread = vi.spyOn(execution, 'protocolStatsInputs').mockImplementationOnce(() => null);
  t.onTestFinished(() => { unread.mockImplementation(() => fixtureInputs()); });
  const reads = loadT3Reads({ db, ...NOWHERE }, NOW);
  assert.deepEqual([reads.usage(['a']), reads.stats(['a']), reads.statsUnavailable, reads.priced, reads.allObserved], ['loading', undefined, false, null, false]);
  assert.equal(reads.usage([]), 'current');
});

test("a warm reads the transcripts of T3's threads not read yet, so the stats read after it reads none", async (t) => {
  const home = tempDir(t, 'lar-home-');
  claudeHome(t, { 'session-a': { main: [assistant('msg-1', 0, 0, 0, 7)] }, 'session-other': { main: [assistant('msg-2', 0, 0, 0, 9)] } }, join(home, '.claude'));
  const db = statsDb(t, [{ id: 'a', messages: [`$lar-work ${REPO}#1`], sessions: ['session-a'], turns: [turn] }]);
  vi.stubEnv('T3_STATE_DB', db);
  t.onTestFinished(() => { vi.unstubAllEnvs(); });
  const sources = { ...NOWHERE, db, home };
  assert.equal((await warmT3Stats(sources)).files, 1, 'only the transcript of a T3 thread');
  const warm = await warmT3Stats(sources);
  assert.equal(warm.files, 0);
  assert.equal(found(warm.read(NOW).stats(['a'])).tokens, 7);
  const missing = await warmT3Stats({ ...sources, db: join(tmpdir(), 'no-such-dir', 'statev2.sqlite') });
  assert.equal(missing.files, 0, 'no database, nothing to read');
  assert.equal(missing.read(NOW).statsUnavailable, true, 'and its read says so');
});
