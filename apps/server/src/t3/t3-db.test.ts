import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { threadRows, liveProjects, readT3Db, threadByTitle, threadSessions } from './t3-db.ts';
import { projectThreadsDb, projectsDb, statsDb } from '../../test/stats-db.ts';

test('threads come back in one query, each with its title, lineage and deletion time and, for a root, its first user message', (t) => {
  const db = statsDb(t, [
    { id: 'root', messages: ['Build x/y#1', 'later'] },
    { id: 'child', rootThreadId: 'root', messages: ['Build x/y#2'] },
  ]);
  const { threads } = readT3Db(db, threadRows);
  assert.deepEqual(threads.map((row) => ({ ...row })), [
    { id: 'root', title: 'root', deletedAt: null, root: 'root', parent: null, text: 'Build x/y#1' },
    { id: 'child', title: 'child', deletedAt: null, root: 'root', parent: 'root', text: null },
  ]);
});

test('a thread\'s sessions come back earliest first', (t) => {
  const db = statsDb(t, [{ id: 'a', sessions: [{ session: 's2', createdAt: '2026-10-20T09:00:00Z' }, { session: 's1', createdAt: '2026-10-20T08:00:00Z' }] }]);
  assert.deepEqual(readT3Db(db, threadSessions).map((row) => ({ ...row })), [
    { thread: 'a', driver: 'claudeAgent', instance: 'claudeAgent', session: 's1' },
    { thread: 'a', driver: 'claudeAgent', instance: 'claudeAgent', session: 's2' },
  ]);
});

test('live projects leave deleted ones out and give each title and folder with `~` expanded and no trailing slash', (t) => {
  const db = projectsDb(t, [{ id: 'a', root: '~/lar/' }, { id: 'b', root: '/srv/b', deletedAt: '2026-10-20T08:00:00Z' }]);
  assert.deepEqual(liveProjects(db, '/Users/me'), [{ id: 'a', title: 'a', folder: '/Users/me/lar' }]);
});

test("a project's thread found by its title gives its id and latest assistant message, leaving deleted threads and other projects out", (t) => {
  const db = projectThreadsDb(t, [
    { id: 'gone', project: 'web', title: 'Look for Clashes (run a1)', createdAt: '2026-10-27T09:00:00Z', deletedAt: '2026-10-27T09:30:00Z' },
    { id: 'other', project: 'api', title: 'Look for Clashes (run a1)', createdAt: '2026-10-27T10:00:00Z' },
    { id: 'run', project: 'web', title: 'Look for Clashes (run a1)', createdAt: '2026-10-27T08:00:00Z', messages: [
      { role: 'user', text: 'Look for Clashes' }, { role: 'assistant', text: 'Listing files' }, { role: 'assistant', text: 'Reading AGENTS.md' }] },
  ]);
  assert.deepEqual(threadByTitle(db, 'web', 'Look for Clashes (run a1)'), { threadId: 'run', latest: 'Reading AGENTS.md' });
  assert.deepEqual(threadByTitle(db, 'api', 'Look for Clashes (run a1)'), { threadId: 'other', latest: null });
  assert.equal(threadByTitle(db, 'web', 'Look for Clashes (run b2)'), null);
});
