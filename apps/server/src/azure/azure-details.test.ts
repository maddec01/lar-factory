import type { Item } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { readAzureItemDetails, readAzureOlderComments } from './azure-details.ts';
import { fakeAz, type FakeComment, type WorkItem } from './fake-az.ts';

const REPO = 'contoso/Fabrikam%20Fiber/lar-api';
const item = (number: number): Item =>
    ({
        id: `azure:contoso/${number}`,
        content: 'ticket',
        revision: 0,
        kind: 'issue',
        parentId: null,
        repo: REPO,
        number,
    }) as Item;
const workItem = (extra: Partial<WorkItem> = {}): WorkItem => ({
    id: 5,
    type: 'User Story',
    state: 'Active',
    createdBy: 'Ana Silva',
    assignedTo: 'Rui Costa',
    created: '2026-10-12T09:14:00Z',
    iteration: 'Fabrikam Fiber\\Sprint 12',
    ...extra,
});
const comment = (id: number, extra: Partial<FakeComment> = {}): FakeComment => ({
    id,
    by: 'Ana Silva',
    date: `2026-10-${10 + id}T08:00:00Z`,
    text: `Comment ${id}`,
    format: 'markdown',
    ...extra,
});

test('a markdown description answers with its people, dates, iteration and area', async () => {
    const az = fakeAz({
        items: [workItem({ description: '## Export\n\nAs **CSV**.', descriptionFormat: 'Markdown' })],
    });

    assert.deepEqual(await readAzureItemDetails(item(5), az.run), {
        body: '## Export\n\nAs **CSV**.',
        format: 'markdown',
        bodyField: 'System.Description',
        revision: 1,
        author: 'Ana Silva',
        assignees: ['Rui Costa'],
        createdAt: '2026-10-12T09:14:00Z',
        iteration: 'Fabrikam Fiber\\Sprint 12',
        area: 'Fabrikam Fiber\\Fabrikam Team',
        subTickets: [],
        comments: [],
        hasOlderComments: false,
        olderCursor: null,
    });
});

test('the child work items answer as sub-tickets, Completed ones closed and Removed ones left out, from one batch read', async () => {
    const az = fakeAz({
        items: [
            workItem({ type: 'User Story' }),
            { id: 6, type: 'Task', state: 'Active', parent: 5, title: 'Write the exporter' },
            { id: 7, type: 'Task', state: 'Closed', parent: 5, title: 'Add the button' },
            { id: 8, type: 'Task', state: 'Removed', parent: 5, title: 'Dropped idea' },
            { id: 9, type: 'Task', state: 'Active', title: 'Unrelated' },
        ],
    });
    const details = await readAzureItemDetails(item(5), az.run);

    assert.ok(!('error' in details));
    assert.deepEqual(details.subTickets, [
        {
            number: 6,
            title: 'Write the exporter',
            url: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/6',
            repo: REPO,
            state: 'open',
            azure: { type: 'Task', state: 'Active', assignee: null },
        },
        {
            number: 7,
            title: 'Add the button',
            url: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/7',
            repo: REPO,
            state: 'closed',
            azure: { type: 'Task', state: 'Closed', assignee: null },
        },
    ]);
    assert.deepEqual(az.batches, [[5], [6, 7, 8]]);
});

const managed = (id: number) =>
    comment(id, {
        text:
            id % 2
                ? '<!-- lar-factory:chunk version=1 -->\nc2VjcmV0LWJhc2U2NA=='
                : '<!-- lar-factory:structure\n{}\n-->',
    });
const commentCalls = (az: ReturnType<typeof fakeAz>) => az.calls.filter((args) => args.includes('comments'));

test('details and older pages skip managed-only history to its end without exposing transport comments', async () => {
    for (const older of [false, true]) {
        const az = fakeAz({
            items: [
                workItem({
                    description: 'Human description.\n\n<!-- lar-factory:structure\n{}\n-->',
                    comments: Array.from({ length: 125 }, (_, i) => managed(i + 1)),
                }),
            ],
        });
        const page = older
            ? await readAzureOlderComments(item(5), '0', az.run)
            : await readAzureItemDetails(item(5), az.run);

        assert.ok(!('error' in page));
        assert.deepEqual([page.comments, page.olderCursor], [[], null]);

        if ('hasOlderComments' in page && 'body' in page)
            assert.deepEqual([page.hasOlderComments, page.body], [false, 'Human description.']);

        assert.equal(commentCalls(az).length, 3);
        assert.doesNotMatch(JSON.stringify(page), /lar-factory:|c2VjcmV0/);
    }
});

test('ordinary history keeps ten-comment pages in order without gaps or duplicate comments', async () => {
    const az = fakeAz({ items: [workItem({ comments: Array.from({ length: 23 }, (_, i) => comment(i + 1)) })] });
    const details = await readAzureItemDetails(item(5), az.run);

    assert.ok(!('error' in details));

    const ids = details.comments.map((c) => c.id);
    let cursor = details.olderCursor;

    while (cursor !== null) {
        const page = await readAzureOlderComments(item(5), cursor, az.run);

        assert.ok(!('error' in page));
        ids.push(...page.comments.map((c) => c.id));
        cursor = page.olderCursor;
    }

    assert.deepEqual(
        ids,
        Array.from({ length: 23 }, (_, i) => String(23 - i)),
    );
    assert.equal(commentCalls(az).length, 3);
});

test('attachments survive a failed relation read and only link to Azure over HTTPS', async () => {
    const url = 'https://dev.azure.com/contoso/_apis/wit/attachments/document-id';
    const az = fakeAz({
        items: [
            workItem({
                predecessors: [7],
                attachments: [
                    { name: 'Evidence.pdf', url },
                    { name: 'Bad scheme', url: 'javascript:alert(1)' },
                    { name: 'Insecure', url: 'http://dev.azure.com/contoso/doc' },
                    { name: 'Other host', url: 'https://dev.azure.com.example.com/doc' },
                ],
            }),
            { id: 7, type: 'Task', state: 'Active' },
        ],
        fail: (args) => (args.includes('workitemtypestates') ? new Error('Relations unavailable') : undefined),
    });
    const details = await readAzureItemDetails(item(5), az.run);

    assert.ok(!('error' in details));
    assert.deepEqual(details.attachments, [{ name: 'Evidence.pdf', url }]);
    assert.equal(details.relationsError, 'Relations unavailable');
});

test('a Bug displays Repro Steps even when Description also contains text', async () => {
    const run = fakeAz({
        items: [workItem({ type: 'Bug', description: 'Separate description.', reproSteps: '<p>Displayed steps.</p>' })],
    });
    const details = await readAzureItemDetails(item(5), run.run);

    if ('error' in details) throw Error(details.error);

    assert.equal(details.bodyField, 'Microsoft.VSTS.TCM.ReproSteps');
    assert.equal(details.body, '<p>Displayed steps.</p>');
    assert.deepEqual(details.sections, [{ title: 'Description', body: 'Separate description.', format: 'markdown' }]);
});
