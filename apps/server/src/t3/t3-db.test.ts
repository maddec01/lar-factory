import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { projectsDb, statsDb } from '../../test/stats-db.ts';
import { threadRows, liveProjects, readT3Db } from './t3-db.ts';

test('threads come back in one query, each with its title, lineage and deletion time and, for a root, its first user message', (t) => {
    const db = statsDb(t, [
        { id: 'root', messages: ['Build x/y#1', 'later'] },
        { id: 'child', rootThreadId: 'root', messages: ['Build x/y#2'] },
    ]);
    const { threads } = readT3Db(db, threadRows);

    assert.deepEqual(
        threads.map((row) => ({ ...row })),
        [
            { id: 'root', title: 'root', deletedAt: null, root: 'root', parent: null, text: 'Build x/y#1' },
            { id: 'child', title: 'child', deletedAt: null, root: 'root', parent: 'root', text: null },
        ],
    );
});

test('live projects leave deleted ones out and give each title and folder with `~` expanded and no trailing slash', (t) => {
    const db = projectsDb(t, [
        { id: 'a', root: '~/lar/' },
        { id: 'b', root: '/srv/b', deletedAt: '2026-10-20T08:00:00Z' },
    ]);

    assert.deepEqual(liveProjects(db, '/Users/me'), [{ id: 'a', title: 'a', folder: '/Users/me/lar' }]);
});
