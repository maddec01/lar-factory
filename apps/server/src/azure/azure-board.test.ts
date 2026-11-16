import { isBuild, openBlockers } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { azureBoard } from './azure-board.ts';
import { fakeAz } from './fake-az.ts';

const REPO = 'contoso/Fabrikam%20Fiber/lar-api';

test('the Azure board combines backlog and sprint once, keeping sprint completion and Task counts', async () => {
    const az = fakeAz({
        items: [
            { id: 1, type: 'User Story', state: 'New' },
            { id: 2, type: 'User Story', state: 'Active' },
            { id: 3, type: 'User Story', state: 'Closed' },
            { id: 4, type: 'User Story', state: 'Closed' },
            { id: 5, type: 'Task', state: 'New', parent: 2 },
            { id: 6, type: 'User Story', state: 'Active', area: 'Another team' },
        ],
        backlog: [1, 2, 3, 4, 6],
        sprint: [2, 3, 5, 6],
    });
    const source = azureBoard([REPO], 'Fabrikam Team', az.run);
    const read = await source.read();

    assert.deepEqual(
        read.items.map((i) => i.number).sort((a, b) => a - b),
        [1, 2, 3, 6],
    );
    assert.equal(read.items.find((i) => i.number === 3)?.status, 'Done');
    assert.deepEqual(
        (await source.readSome!(read.items)).map((i) => i.number).sort((a, b) => a - b),
        [1, 2, 3, 6],
    );
});

test('the Azure board reports sprint read failures instead of silently dropping its items', async () => {
    const az = fakeAz({
        items: [],
        fail: (args) => (args.includes('list-work-items') ? new Error('Sprint unavailable') : undefined),
    });

    await assert.rejects(azureBoard([REPO], 'Fabrikam Team', az.run).read(), /Sprint unavailable/);
});

test('a concept exposes its Ready child build outside the sprint, while plain team Tasks stay hidden', async () => {
    const az = fakeAz({
        items: [
            { id: 1, type: 'User Story', state: 'Active', tags: 'concept; status-shaping' },
            { id: 11, type: 'Task', state: 'New', parent: 1, tags: 'build; status-ready' },
            { id: 12, type: 'Task', state: 'New', parent: 1, title: 'Implement' },
            { id: 111, type: 'Task', state: 'New', parent: 11, title: 'A slice', tags: 'active' },
        ],
        backlog: [1],
        sprint: [],
    });
    const source = azureBoard([REPO], 'Fabrikam Team', az.run);
    const read = await source.read();

    assert.deepEqual(
        read.items.map((i) => i.number),
        [1, 11],
    );

    const build = read.items[1]!;

    assert.equal(build.status, 'Ready');
    assert.equal(isBuild(build), true);
    assert.deepEqual(openBlockers(build), []);
    assert.equal(build.parent?.number, 1);
    assert.deepEqual(build.subIssues, { total: 1, completed: 0 });
    assert.deepEqual(
        (await source.readSome!([build])).map((i) => [i.number, i.status, i.parent?.number]),
        [[11, 'Ready', 1]],
    );
});
