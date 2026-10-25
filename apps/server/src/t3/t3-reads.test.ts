import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadT3Reads } from './t3-reads.ts';
import { statsDb } from '../../test/stats-db.ts';

/** A home folder, settings and price table that don't exist, so tests never read real transcripts. */
const NOWHERE = {
  settings: join(tmpdir(), 'no-such-dir', 'settings.json'),
  rates: join(tmpdir(), 'no-such-dir', 'usage-model-rates.json'),
  home: join(tmpdir(), 'no-such-dir', 'home'),
};
const NOW = Date.parse('2026-10-20T12:00:00Z');
const REPO = 'maddec01/lar-factory';
/** Issue `number` in lar-factory, as the board item the lookups take. */
const item = (number: number | null) => ({ repo: REPO, number });
/** A lookup's result once it's read, failing the test when there was none or it was unavailable. */
function found<T>(value: T | 'unavailable' | undefined): T {
  assert.ok(value !== undefined && value !== 'unavailable', `expected a read, got ${value}`);
  return value;
}
const turn = { id: 'a1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z' };

/** Renames a column in the database at `path`, as a T3 schema change would. */
function renameColumn(path: string, table: string, from: string, to: string): void {
  const db = new DatabaseSync(path);
  db.exec(`ALTER TABLE ${table} RENAME COLUMN ${from} TO ${to}`);
  db.close();
}

test('one read of the database gives each item its stats and threads, and undefined for an item with none', (t) => {
  const db = statsDb(t, [{ id: 'a', title: 'Shape #1', messages: [`$lar-work ${REPO}#1`], turns: [turn] }]);
  const reads = loadT3Reads({ db, ...NOWHERE }, NOW);
  assert.equal(found(reads.stats(item(1))).agentMs, 10 * 60_000);
  assert.deepEqual(found(reads.threads(item(1))).map((th) => [th.id, th.state]), [['a', 'done']]);
  assert.deepEqual([reads.stats(item(2)), reads.threads(item(2))], [undefined, undefined]);
  assert.deepEqual([reads.stats({ repo: null, number: null }), reads.threads(item(null))], [undefined, undefined], 'a draft names no issue');
  assert.deepEqual([reads.statsUnavailable, reads.priced], [false, false], 'no rate table, so nothing is priced');
});

test('a missing database gives no stats or threads, and an unexpected schema gives unavailable', (t) => {
  const missing = loadT3Reads({ db: join(tmpdir(), 'no-such-dir', 'statev2.sqlite'), ...NOWHERE }, NOW);
  assert.deepEqual([missing.stats(item(1)), missing.threads(item(1)), missing.statsUnavailable, missing.priced], [undefined, undefined, false, null]);
  const changed = statsDb(t, [{ id: 'a', messages: [`$lar-work ${REPO}#1`] }]);
  renameColumn(changed, 'orchestration_v2_projection_provider_turns', 'started_at', 'began_at');
  const broken = loadT3Reads({ db: changed, ...NOWHERE }, NOW);
  assert.deepEqual([broken.stats(item(1)), broken.threads(item(1)), broken.statsUnavailable, broken.priced], ['unavailable', 'unavailable', true, null]);
});

test('stats read more than the thread rows, so they can be unavailable while the threads are read', (t) => {
  const db = statsDb(t, [{ id: 'a', title: 'Shape #1', messages: [`$lar-work ${REPO}#1`], turns: [turn] }]);
  renameColumn(db, 'orchestration_v2_projection_provider_threads', 'payload_json', 'payload');
  const reads = loadT3Reads({ db, ...NOWHERE }, NOW);
  assert.equal(reads.stats(item(1)), 'unavailable');
  assert.equal(reads.statsUnavailable, true);
  assert.deepEqual(found(reads.threads(item(1))).map((th) => th.id), ['a']);
});
