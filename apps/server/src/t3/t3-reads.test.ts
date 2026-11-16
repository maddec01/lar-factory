import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, vi } from 'vite-plus/test';

import { statsDb } from '../../test/stats-db.ts';
import * as execution from './item-execution.ts';
import { readT3Stats } from './t3-reads.ts';

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
    assert.ok(value !== undefined && value !== 'unavailable', `expected a read, got ${String(value)}`);

    return value;
}

const turn = { id: 'a1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z' };

test("one read of the database gives each item its record's threads' stats, and undefined for an item with none", async (t) => {
    const db = statsDb(t, [{ id: 'a', title: 'Shape #1', messages: [`$lar-work ${REPO}#1`], turns: [turn] }]);

    vi.stubEnv('T3_STATE_DB', db);
    t.onTestFinished(() => {
        vi.unstubAllEnvs();
    });

    const reads = await readT3Stats({ db, ...NOWHERE }, { now: NOW });

    assert.equal(found(reads.stats(['a'])).agentMs, 10 * 60_000);
    assert.equal(reads.stats(['gone']), undefined);
    assert.deepEqual([reads.statsUnavailable, reads.priced], [false, false], 'no rate table, so nothing is priced');
});

test('a failed thread fails only the items whose family holds it, and an item with no threads is never unavailable', async (t) => {
    const db = statsDb(t, [
        { id: 'a', messages: [`$lar-work ${REPO}#1`], turns: [turn] },
        { id: 'b', read: 'failed', messages: [`$lar-work ${REPO}#2`], turns: [{ ...turn, id: 'b1' }] },
        { id: 'b-child', rootThreadId: 'b', turns: [] },
        { id: 'c', read: 'failed', rootThreadId: 'd', turns: [] },
        { id: 'd', messages: [`$lar-work ${REPO}#3`], turns: [{ ...turn, id: 'd1' }] },
    ]);

    vi.stubEnv('T3_STATE_DB', db);
    t.onTestFinished(() => {
        vi.unstubAllEnvs();
    });

    const reads = await readT3Stats({ db, ...NOWHERE }, { now: NOW });

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
