import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { agentTimeRows, liveProjects, readT3Db, threadSessions } from './t3-db.ts';
import { projectsDb, statsDb } from '../../test/stats-db.ts';

test('threads come back in one query, each with its lineage and, for a root, its first user message', (t) => {
  const db = statsDb(t, [
    { id: 'root', messages: ['Build x/y#1', 'later'] },
    { id: 'child', rootThreadId: 'root', messages: ['Build x/y#2'] },
  ]);
  const { threads } = readT3Db(db, agentTimeRows);
  assert.deepEqual(threads.map((row) => ({ ...row })), [
    { id: 'root', root: 'root', parent: null, text: 'Build x/y#1' },
    { id: 'child', root: 'root', parent: 'root', text: null },
  ]);
});

test('a thread\'s sessions come back earliest first', (t) => {
  const db = statsDb(t, [{ id: 'a', sessions: [{ session: 's2', createdAt: '2026-10-20T09:00:00Z' }, { session: 's1', createdAt: '2026-10-20T08:00:00Z' }] }]);
  assert.deepEqual(readT3Db(db, threadSessions).map((row) => ({ ...row })), [
    { thread: 'a', driver: 'claudeAgent', instance: 'claudeAgent', session: 's1' },
    { thread: 'a', driver: 'claudeAgent', instance: 'claudeAgent', session: 's2' },
  ]);
});

test('live projects leave deleted ones out and give each folder with `~` expanded and no trailing slash', (t) => {
  const db = projectsDb(t, [{ id: 'a', root: '~/Mux/' }, { id: 'b', root: '/srv/b', deletedAt: '2026-10-20T08:00:00Z' }]);
  assert.deepEqual(liveProjects(db, '/Users/pedro'), [{ id: 'a', folder: '/Users/pedro/Mux' }]);
});
