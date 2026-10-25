import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { itemThreads } from './item-threads.ts';
import { readT3Db, threadRows } from '../t3/t3-db.ts';
import type { ItemThreadsReader } from './item-threads.ts';
import { statsDb } from '../../test/stats-db.ts';
import type { FixtureRequest, FixtureThread } from '../../test/stats-db.ts';

const REPO = 'maddec01/lar-factory';

function reader(t: TestContext, threads: FixtureThread[], requests: FixtureRequest[] = []): ItemThreadsReader {
  return readT3Db(statsDb(t, threads, requests), (db) => itemThreads(threadRows(db)));
}

test('an item thread is running with a turn in flight, needs you with a runtime request open, else done', (t) => {
  const threadsOf = reader(t, [
    { id: 'running', title: 'Build: owner accounts', messages: [`Build ${REPO}#1`], turns: [
      { id: 'r1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z' },
      { id: 'r2', startedAt: '2026-10-20T11:00:00Z' },
    ] },
    { id: 'asking', title: 'Prototype: sign-in screen', messages: [`$lar-work ${REPO}#1`], turns: [{ id: 'a1', startedAt: '2026-10-20T10:00:00Z' }] },
    { id: 'answered', messages: [`$lar-work ${REPO}#1`], turns: [{ id: 'd1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:30:00Z' }] },
    // A turn whose run failed stays open with its provider thread idle: nothing is in flight.
    { id: 'abandoned', messages: [`$lar-work ${REPO}#1`], turns: [{ id: 'x1', startedAt: '2026-10-20T08:30:00Z', abandoned: true }] },
  ], [
    { turnId: 'a1', createdAt: '2026-10-20T10:05:00Z' },
    { turnId: 'd1', createdAt: '2026-10-20T09:05:00Z', resolvedAt: '2026-10-20T09:20:00Z' },
  ]);
  assert.deepEqual(threadsOf(REPO, 1), [
    { id: 'running', title: 'Build: owner accounts', state: 'running', updated: '2026-10-20T11:00:00.000Z' },
    { id: 'asking', title: 'Prototype: sign-in screen', state: 'needs you', updated: '2026-10-20T10:05:00.000Z' },
    { id: 'answered', title: 'answered', state: 'done', updated: '2026-10-20T09:30:00.000Z' },
    { id: 'abandoned', title: 'abandoned', state: 'done', updated: '2026-10-20T08:30:00.000Z' },
  ], 'newest first, each updated at its latest message, turn or request time');
});

test('a thread belongs only to the issue its first message names first, and child and deleted threads are left out', (t) => {
  const threadsOf = reader(t, [
    { id: 'first', messages: [`Build ${REPO}#3, then $lar-work ${REPO}#4`, `$lar-work ${REPO}#5`] },
    { id: 'child', rootThreadId: 'first', messages: [`Build ${REPO}#3`] },
    { id: 'gone', messages: [`Build ${REPO}#3`], deletedAt: '2026-10-21T08:00:00Z' },
    { id: 'upper', messages: [`$lar-work Maddec01/Lar-Factory#3`] },
  ]);
  assert.deepEqual(threadsOf(REPO, 3).map((thread) => thread.id).sort(), ['first', 'upper']);
  assert.deepEqual(threadsOf(REPO, 4), []);
  assert.deepEqual(threadsOf(REPO, 5), []);
  assert.deepEqual(threadsOf(REPO, 6), [], 'an item no thread names has none');
});
