import type { Item } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { azureBoard } from './azure-board.ts';
import { fakeAz, type WorkItem } from './fake-az.ts';

const WEB = 'contoso/Fabrikam%20Fiber/web';
const API = 'contoso/Fabrikam%20Fiber/Web%20Api';
const TEAM = 'Fabrikam Team';

const placed = (items: Item[]) => items.map((i) => [i.number, i.repo, i.untaggedFor ?? null]);

test("with web and api reading one sprint, an untagged item is for both, and a repo- tag places it in its repository's List only", async () => {
    const items: WorkItem[] = [
        { id: 1, type: 'User Story', state: 'New' },
        { id: 2, type: 'User Story', state: 'New', tags: 'repo-web; area-ui' },
        { id: 3, type: 'User Story', state: 'New', tags: 'repo-Web Api' },
    ];
    const read = await azureBoard([WEB, API], TEAM, fakeAz({ items }).run).read();

    assert.deepEqual(placed(read.items), [
        [1, WEB, [WEB, API]],
        [2, WEB, null],
        [3, API, null],
    ]);
    assert.deepEqual(read.items[1]!.labels, ['area-ui'], 'the repository tag is no label');
});

test('a ticket search lists the open backlog items for the repository whose title has every word, and a number reads that item alone', async () => {
    const items: WorkItem[] = [
        { id: 1, type: 'User Story', state: 'New', title: 'Export the report' },
        { id: 2, type: 'User Story', state: 'Active', title: 'Report export for api', tags: 'repo-Web Api' },
        { id: 3, type: 'User Story', state: 'Closed', title: 'Export old report' },
        { id: 4, type: 'User Story', state: 'New', title: 'Export a report', tags: 'repo-web' },
        { id: 5, type: 'User Story', state: 'New', title: 'Import a report' },
    ];
    const source = azureBoard([WEB, API], TEAM, fakeAz({ items }).run);
    const url = (id: number) => `https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/${id}`;

    assert.deepEqual(await source.searchTickets(API, 'EXPORT report'), [
        { number: 1, title: 'Export the report', url: url(1) },
        { number: 2, title: 'Report export for api', url: url(2) },
    ]);
    assert.deepEqual(await source.searchTickets(API, '#5'), [{ number: 5, title: 'Import a report', url: url(5) }]);
    assert.deepEqual(await source.searchTickets(API, '4'), [], "another repository's item");
});

test("a ticket read gives an open work item's description and kind, and nothing for a closed one or another repository's", async () => {
    const items: WorkItem[] = [
        {
            id: 1,
            type: 'User Story',
            state: 'New',
            title: 'Export',
            tags: 'bug',
            description: '## Steps',
            descriptionFormat: 'Markdown',
        },
        { id: 2, type: 'User Story', state: 'Closed', title: 'Old' },
        { id: 3, type: 'User Story', state: 'New', title: 'Theirs', tags: 'repo-web' },
    ];
    const source = azureBoard([WEB, API], TEAM, fakeAz({ items }).run);

    assert.deepEqual(await source.readTicket(API, 1), {
        number: 1,
        title: 'Export',
        url: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/1',
        text: '## Steps',
        kind: 'bug',
    });
    assert.equal(await source.readTicket(API, 2), null);
    assert.equal(await source.readTicket(API, 3), null);
    assert.equal(await source.readTicket(API, 99), null);
});

test('a ticket observation reads a work item open or not, with its assignee, and a confirmed not-found', async () => {
    const items: WorkItem[] = [
        { id: 1, type: 'User Story', state: 'Active', title: 'Export', assignedTo: 'Ana Silva' },
        { id: 2, type: 'User Story', state: 'Closed', title: 'Old', tags: 'repo-web' },
        { id: 3, type: 'User Story', state: 'Removed', title: 'Abandoned', tags: 'repo-web' },
    ];
    const source = azureBoard([WEB, API], TEAM, fakeAz({ items }).run);

    assert.deepEqual(await source.observeTicket(API, 1), {
        abandonmentComplete: false,
        state: 'open',
        assignee: 'Ana Silva',
    });
    assert.deepEqual(await source.observeTicket(API, 2), { abandonmentComplete: false, state: 'closed' });
    assert.deepEqual(await source.observeTicket(API, 3), { abandonmentComplete: true, state: 'closed' });
    assert.deepEqual(await source.observeTicket(API, 99), { state: 'not-found' });
});
