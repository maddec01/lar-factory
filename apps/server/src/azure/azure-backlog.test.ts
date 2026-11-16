import type { Item } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { readBacklog } from './azure-backlog.ts';
import { azureItems, type Az } from './azure-items.ts';
import { TEAM_AREA, fakeAz, type WorkItem } from './fake-az.ts';

const azureBacklog = (repos: readonly string[], team: string, run: Az) =>
    azureItems(repos, team, (calls) => readBacklog(team, calls), run);

const REPO = 'contoso/Fabrikam%20Fiber/lar-api';
const TEAM = 'Fabrikam Team';

const shown = (items: Item[]) => items.map((i) => [i.number, i.status, i.parent?.number ?? null]);

const BACKLOG: WorkItem[] = [
    { id: 1, type: 'User Story', state: 'Active', title: 'Seek', tags: 'status-shaping', predecessors: [2, 99] },
    { id: 11, type: 'Task', state: 'Active', parent: 1 },
    { id: 12, type: 'Task', state: 'Closed', parent: 1 },
    { id: 13, type: 'Task', state: 'Removed', parent: 1 },
    { id: 2, type: 'User Story', state: 'New', title: 'Next sprint' },
    { id: 3, type: 'User Story', state: 'New', title: 'No sprint', area: `${TEAM_AREA}\\Search` },
    { id: 4, type: 'User Story', state: 'Closed', title: 'Shipped' },
    { id: 5, type: 'User Story', state: 'Removed', title: 'Dropped' },
    { id: 6, type: 'Epic', state: 'Active', title: 'Big' },
    { id: 7, type: 'User Story', state: 'Active', title: 'Theirs', area: 'Fabrikam Fiber\\Other Team' },
    { id: 99, type: 'User Story', state: 'Closed', title: 'Earlier', area: 'Fabrikam Fiber\\Other Team' },
];

test("a backlog read lists the team's open requirement-level items under its area paths, in any sprint or none", async () => {
    const az = fakeAz({ items: BACKLOG, backlog: [1, 2, 3, 4, 5, 6, 7] });
    const read = await azureBacklog([REPO], TEAM, az.run).read();

    assert.equal(read.title, 'Fabrikam Team backlog');
    // 4 is Completed, 5 Removed, 6 an Epic and 7 under another team's area path.
    assert.deepEqual(shown(read.items), [
        [1, 'Shaping', null],
        [2, 'List', null],
        [3, 'List', null],
    ]);
});

test('Tasks count toward their parent, read through its child links, and Predecessors are blockers', async () => {
    const az = fakeAz({ items: BACKLOG, backlog: [1] });
    const [seek] = (await azureBacklog([REPO], TEAM, az.run).read()).items;

    assert.deepEqual(seek!.subIssues, { total: 2, completed: 1 });
    assert.deepEqual(seek!.blockers, [
        { number: 2, repo: REPO, state: 'open' },
        { number: 99, repo: REPO, state: 'closed' },
    ]);
    // The Tasks, then the predecessors outside the backlog, each in a batch of their own.
    assert.deepEqual(az.batches, [[1], [11, 12, 13], [2, 99]]);
});

test('backlog priority order survives hydration that returns work items in ID order', async () => {
    const az = fakeAz({ items: BACKLOG, backlog: [3, 1, 2] });
    const source = azureBacklog([REPO], TEAM, az.run);
    const items = (await source.read()).items;

    assert.deepEqual(
        items.map((item) => [item.number, item.sourceOrder]),
        [
            [3, 0],
            [1, 1],
            [2, 2],
        ],
    );
    assert.equal((await source.readSome!([items[1]!]))[0]!.sourceOrder, 1);
});
