import type { Item, Status } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { azureBoard } from './azure-board.ts';
import { saveAzureDescription } from './azure-writes.ts';
import { fakeAz, type WorkItem } from './fake-az.ts';

const REPO = 'contoso/Fabrikam%20Fiber/api';
const TEAM = 'Fabrikam Team';

const ITEMS: WorkItem[] = [
    { id: 1, type: 'User Story', state: 'New', tags: 'area-api; status-queued' },
    { id: 2, type: 'Product Backlog Item', state: 'Committed', tags: 'status-shaping' },
    { id: 3, type: 'User Story', state: 'Closed', tags: 'status-verify; area-api' },
    { id: 4, type: 'User Story', state: 'Active', tags: 'status-shaping; area-api' },
    { id: 5, type: 'Issue', state: 'To Do' },
    { id: 6, type: 'User Story', state: 'New', tags: 'status-review; status-queued' },
    { id: 7, type: 'User Story', state: 'New', tags: Array.from({ length: 100 }, (_, i) => `tag-${i + 1}`).join('; ') },
];

/** The sprint over ITEMS, its fake az, and the item numbered `id` as the board read it. */
async function board(id: number, fail?: (args: string[]) => Error | undefined) {
    const az = fakeAz({ items: ITEMS, requirement: 'User Story', fail });
    const source = azureBoard([REPO], TEAM, az.run);
    const { items } = await source.read();
    // The read shows only the requirement level's type, so another type's item stands in as the first item renumbered.
    const item = items.find((i) => i.number === id) ?? { ...items[0]!, number: id, statuses: [] as Status[] };

    return { az, source, item };
}

const stateTo = (state: string) => ({ op: 'replace', path: '/fields/System.State', value: state });

test('Abandon moves the work item to its Removed-category state, and names a type with none', async () => {
    const story = await board(4);

    assert.equal(await story.source.abandon(story.item), null);
    assert.deepEqual(story.az.patches, [{ id: 4, ops: [{ op: 'test', path: '/rev', value: 1 }, stateTo('Removed')] }]);

    const issue = await board(5);

    assert.equal(
        await issue.source.abandon(issue.item),
        'Could not abandon work item 5. Issue in Fabrikam Fiber has no Removed-category state. Close or delete it in Azure DevOps.',
    );
    assert.deepEqual(issue.az.patches, []);
});

const workItem = (number: number) =>
    ({
        id: `azure:contoso/${number}`,
        content: 'ticket',
        revision: 0,
        kind: 'issue',
        parentId: null,
        repo: REPO,
        number,
    }) as Item;

test('a saved description replaces the field the details read, as markdown, at 7.2-preview.3 and testing the rev read', async () => {
    const az = fakeAz({ items: ITEMS });

    assert.equal(
        await saveAzureDescription(
            workItem(4),
            { body: '- a\n- b', bodyField: 'System.Description', revision: 1 },
            az.run,
        ),
        null,
    );

    const patch = az.calls.at(-1)!;

    assert.equal(
        patch[patch.indexOf('--url') + 1],
        'https://dev.azure.com/contoso/Fabrikam%20Fiber/_apis/wit/workitems/4?api-version=7.2-preview.3',
    );
    assert.deepEqual(az.patches, [
        {
            id: 4,
            ops: [
                { op: 'test', path: '/rev', value: 1 },
                { op: 'replace', path: '/fields/System.Description', value: '- a\n- b' },
                { op: 'replace', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' },
            ],
        },
    ]);
});

test('a work item changed since its details were read is a conflict, and writes nothing', async () => {
    const az = fakeAz({ items: [{ ...ITEMS[3]!, rev: 3 }] });

    assert.deepEqual(
        await saveAzureDescription(workItem(4), { body: 'New.', bodyField: 'System.Description', revision: 2 }, az.run),
        {
            status: 409,
            error: 'Could not save the description. Someone else changed work item 4 since you opened it. Copy your text, close the item and open it again to edit the latest version.',
        },
    );
    assert.deepEqual(az.patches, []);
});
