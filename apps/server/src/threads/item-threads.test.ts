import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { statsDb } from '../../test/stats-db.ts';
import type { FixtureThread } from '../../test/stats-db.ts';
import { readT3Db, threadRows } from '../t3/t3-db.ts';
import { namedThreads, type NamedThread } from './item-threads.ts';

const REPO = 'maddec01/lar-factory';

function reader(t: TestContext, threads: FixtureThread[]): (repo: string, number: number) => NamedThread[] {
    return readT3Db(statsDb(t, threads), (db) => namedThreads(threadRows(db)));
}

test('a ticket has the live root threads its first messages name, oldest activity first, a Build message building', (t) => {
    const threadsOf = reader(t, [
        { id: 'newer', messages: [`Build ${REPO}#1`], turns: [{ id: 'n1', startedAt: '2026-10-20T11:00:00Z' }] },
        { id: 'older', messages: [`$lar-shape ${REPO}#1`], turns: [{ id: 'o1', startedAt: '2026-10-20T09:00:00Z' }] },
    ]);

    assert.deepEqual(threadsOf(REPO, 1), [
        { threadId: 'older', purpose: 'shape' },
        { threadId: 'newer', purpose: 'build' },
    ]);
});
