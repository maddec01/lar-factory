import type { BoardData } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

const FACTORY = 'maddec01/lar-factory';

const configReads = async (board: Board) =>
    (await board.calls()).filter((args) => args[1]?.endsWith('/.lar-factory.json')).length;

test('local changes show immediately without setup acceptance or a repository PR', async (t) => {
    const board = await startBoard(
        t,
        { repositories: [FACTORY], items: [boardIssue(1, 'Queued', FACTORY)] },
        false,
        true,
    );

    await until(board, (d) => d.items.length === 1);

    const response = await board.post(
        { repo: FACTORY, change: 'override', key: 'role', value: 'My factory' },
        board.url,
        '/api/repositories/settings',
    );
    const { board: data } = (await response.json()) as { board: BoardData };

    assert.equal(response.status, 200);
    assert.equal(data.repos[0]?.setup?.role, 'My factory');

    const docs = await board.post(
        {
            repo: FACTORY,
            change: 'override',
            key: 'domainDocs',
            value: { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' },
        },
        board.url,
        '/api/repositories/settings',
    );

    assert.equal(docs.status, 200);
    assert.ok(!(await board.board()).items[0]?.paused);
    assert.equal(await configReads(board), 0);
});
