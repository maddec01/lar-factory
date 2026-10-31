import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { namedThreads, type NamedThread } from './item-threads.ts';
import { readT3Db, threadRows } from '../t3/t3-db.ts';
import { statsDb } from '../../test/stats-db.ts';
import type { FixtureThread } from '../../test/stats-db.ts';

const REPO = 'maddec01/lar-factory';

function reader(t: TestContext, threads: FixtureThread[]): (repo: string, number: number) => NamedThread[] {
  return readT3Db(statsDb(t, threads), (db) => namedThreads(threadRows(db)));
}

test('a ticket has the live root threads its first messages name, oldest activity first, a Build message building', (t) => {
  const threadsOf = reader(t, [
    { id: 'newer', messages: [`Build ${REPO}#1`], turns: [{ id: 'n1', startedAt: '2026-10-20T11:00:00Z' }] },
    { id: 'older', messages: [`$lar-shape ${REPO}#1`], turns: [{ id: 'o1', startedAt: '2026-10-20T09:00:00Z' }] },
  ]);
  assert.deepEqual(threadsOf(REPO, 1), [{ threadId: 'older', purpose: 'shape' }, { threadId: 'newer', purpose: 'build' }]);
});

test('a thread belongs only to the issue its first message names first, and child and deleted threads are left out', (t) => {
  const threadsOf = reader(t, [
    { id: 'first', messages: [`Build ${REPO}#3, then $lar-work ${REPO}#4`, `$lar-work ${REPO}#5`] },
    { id: 'child', rootThreadId: 'first', messages: [`Build ${REPO}#3`] },
    { id: 'gone', messages: [`Build ${REPO}#3`], deletedAt: '2026-10-21T08:00:00Z' },
    { id: 'upper', messages: [`$lar-work Maddec01/Lar-Factory#3`] },
  ]);
  assert.deepEqual(threadsOf(REPO, 3).map((thread) => thread.threadId).sort(), ['first', 'upper']);
  assert.deepEqual(threadsOf(REPO, 4), []);
  assert.deepEqual(threadsOf(REPO, 5), []);
  assert.deepEqual(threadsOf(REPO, 6), [], 'an item no thread names has none');
});
