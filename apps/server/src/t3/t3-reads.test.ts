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
  assert.deepEqual([missing.stats(['a']), missing.statsUnavailable, missing.priced], ['unavailable', true, null]);
  const changed = statsDb(t, [{ id: 'a', messages: [`$lar-work ${REPO}#1`] }]);
  vi.stubEnv('T3_STATE_DB', changed + '.unavailable');
  t.onTestFinished(() => { vi.unstubAllEnvs(); });
  const broken = loadT3Reads({ db: changed, ...NOWHERE }, NOW);
  assert.deepEqual([broken.stats(['a']), broken.statsUnavailable, broken.priced], ['unavailable', true, null]);
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

test("a warm reads the transcripts of T3's threads not read yet, so the stats read after it reads none", async (t) => {
  const home = tempDir(t, 'lar-home-');
  claudeHome(t, { 'session-a': { main: [assistant('msg-1', 0, 0, 0, 7)] }, 'session-other': { main: [assistant('msg-2', 0, 0, 0, 9)] } }, join(home, '.claude'));
  const db = statsDb(t, [{ id: 'a', messages: [`$lar-work ${REPO}#1`], sessions: ['session-a'], turns: [turn] }]);
  vi.stubEnv('T3_STATE_DB', db);
  t.onTestFinished(() => { vi.unstubAllEnvs(); });
  const sources = { ...NOWHERE, db, home };
  assert.equal(await warmT3Stats(sources), 1, 'only the transcript of a T3 thread');
  assert.equal(await warmT3Stats(sources), 0);
  assert.equal(found(loadT3Reads(sources, NOW).stats(['a'])).tokens, 7);
  assert.equal(await warmT3Stats({ ...sources, db: join(tmpdir(), 'no-such-dir', 'statev2.sqlite') }), 0, 'no database, nothing to read');
});
