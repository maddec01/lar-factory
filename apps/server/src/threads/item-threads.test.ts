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

test('an item thread is running with a turn in flight, needs you with a runtime request open, stopped after failure, else done', (t) => {
  const threadsOf = reader(t, [
    { id: 'running', title: 'Build: owner accounts', messages: [`Build ${REPO}#1`], turns: [
      { id: 'r1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z' },
      { id: 'r2', startedAt: '2026-10-20T11:00:00Z' },
    ] },
    { id: 'asking', title: 'Prototype: sign-in screen', messages: [`$lar-shape ${REPO}#1`], turns: [{ id: 'a1', startedAt: '2026-10-20T10:00:00Z' }] },
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
    { id: 'abandoned', title: 'abandoned', state: 'stopped', updated: '2026-10-20T08:30:00.000Z' },
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

test('interrupted and failed turns stop, and a later turn can run again', (t) => {
  const threadsOf = reader(t, [
    { id: 'interrupted', messages: [`Build ${REPO}#7`], turns: [
      { id: 'i1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z', status: 'interrupted' },
    ] },
    { id: 'failed', messages: [`Build ${REPO}#8`], turns: [
      { id: 'f1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z', status: 'failed' },
    ] },
    { id: 'resumed', messages: [`Build ${REPO}#9`], turns: [
      { id: 'r1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z', status: 'interrupted' },
      { id: 'r2', startedAt: '2026-10-20T10:00:00Z' },
    ] },
  ]);
  assert.equal(threadsOf(REPO, 7)[0]?.state, 'stopped');
  assert.equal(threadsOf(REPO, 8)[0]?.state, 'stopped');
  assert.equal(threadsOf(REPO, 9)[0]?.state, 'running');
});

test('an old open request or provider thread cannot make a later completed turn look active', (t) => {
  const threadsOf = reader(t, [{ id: 'finished', messages: [`Build ${REPO}#10`], turns: [
    { id: 'old', startedAt: '2026-10-20T09:00:00Z' },
    { id: 'new', startedAt: '2026-10-20T10:00:00Z', completedAt: '2026-10-20T10:10:00Z' },
  ] }], [{ turnId: 'old', createdAt: '2026-10-20T09:05:00Z' }]);
  assert.equal(threadsOf(REPO, 10)[0]?.state, 'done');
});


test('the latest turn still needs you while its request is open, even after its reply finishes', (t) => {
  const threadsOf = reader(t, [{ id: 'asking', messages: [`$lar-work ${REPO}#11`], turns: [
    { id: 'a1', startedAt: '2026-10-20T09:00:00Z', completedAt: '2026-10-20T09:10:00Z' },
  ] }], [{ turnId: 'a1', createdAt: '2026-10-20T09:05:00Z' }]);
  assert.equal(threadsOf(REPO, 11)[0]?.state, 'needs you');
});
