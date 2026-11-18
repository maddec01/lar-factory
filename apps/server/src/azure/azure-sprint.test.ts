import type { Item } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import type { ItemSource } from '../items/item-source.ts';
import { mergeSources } from '../items/item-sources.ts';
import { azureItems, type Az } from './azure-items.ts';
import { readSprint } from './azure-sprint.ts';
import { REPO_URL, fakeAz, type FakePr, type WorkItem } from './fake-az.ts';

const azureSprint = (repos: readonly string[], team: string, run: Az) =>
    azureItems(repos, team, (calls) => readSprint(team, calls), run);

const REPO = 'contoso/Fabrikam%20Fiber/api';
const TEAM = 'Fabrikam Team';

const shown = (items: Item[]) => items.map((i) => [i.number, i.status, i.parent?.number ?? null]);

const SPRINT: WorkItem[] = [
    {
        id: 1,
        type: 'User Story',
        state: 'Active',
        title: 'Seek',
        tags: 'status-shaping; area-api',
        predecessors: [2, 99],
    },
    { id: 11, type: 'Task', state: 'Active', parent: 1 },
    { id: 12, type: 'Task', state: 'Closed', parent: 1, closed: '2026-10-20T10:00:00Z' },
    { id: 13, type: 'Task', state: 'Removed', parent: 1 },
    { id: 2, type: 'User Story', state: 'Closed', title: 'Ship', closed: '2026-10-20T09:00:00Z' },
    { id: 3, type: 'User Story', state: 'Removed', title: 'Drop' },
    { id: 4, type: 'Epic', state: 'Active', title: 'Big' },
    { id: 5, type: 'User Story', state: 'New', tags: 'status-review;status-queued' },
    { id: 6, type: 'User Story', state: 'New' },
    { id: 99, type: 'User Story', state: 'Active', title: 'Earlier' },
];

test('a sprint read lists requirement-level items with Task counts, a Completed item as Done, and no Removed item', async () => {
    const az = fakeAz({ items: SPRINT, sprint: [1, 11, 12, 13, 2, 3, 4, 5, 6] });
    const read = await azureSprint([REPO], TEAM, az.run).read();

    assert.equal(read.title, 'Fabrikam Team Sprint 12');
    assert.deepEqual(shown(read.items), [
        [1, 'Shaping', null],
        [2, 'Done', null],
        [5, 'Queued', null],
        [6, 'List', null],
    ]);

    const seek = read.items[0]!;

    assert.deepEqual(
        { ...seek, parent: undefined },
        {
            sourceOrder: 0,
            azure: { type: 'User Story', state: 'Active', assignee: null },
            id: 'azure:contoso/1',
            status: 'Shaping',
            statuses: ['Shaping'],
            content: 'ticket',
            revision: 0,
            kind: 'feature',
            parentId: null,
            flow: 'single',
            number: 1,
            title: 'Seek',
            url: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/1',
            repo: REPO,
            untaggedFor: [REPO],
            labels: ['area-api'],
            state: 'open',
            closedAs: null,
            currentSprint: { name: 'Sprint 12', childNumbers: [11, 12, 13] },
            parent: undefined,
            subIssues: { total: 2, completed: 1 },
            blockers: [
                { number: 2, repo: REPO, state: 'closed' },
                { number: 99, repo: REPO, state: 'open' },
            ],
            updatedAt: '2026-10-21T08:00:00Z',
            closedAt: null,
            linkedPrs: [],
            slices: [],
        },
    );
    assert.deepEqual(
        read.items.find((i) => i.number === 2)!,
        {
            ...read.items.find((i) => i.number === 2)!,
            state: 'closed',
            closedAs: 'done',
            closedAt: '2026-10-20T09:00:00Z',
        },
    );
    // The predecessor outside the sprint is read in a batch of its own, for its state.
    assert.deepEqual(az.batches, [[1, 11, 12, 13, 2, 3, 4, 5, 6], [99]]);
});

/** A source for another repository that lists one item. */
const otherRepo: ItemSource = {
    read: async () => ({
        title: 'acme/ios',
        items: [
            {
                id: 'I_1',
                status: 'List',
                statuses: [],
                content: 'ticket',
                revision: 0,
                kind: 'issue',
                parentId: null,
                flow: 'single',
                number: 1,
                title: 'Apple',
                url: null,
                repo: 'acme/ios',
                labels: [],
                state: 'open',
                closedAs: null,
                parent: null,
                subIssues: { total: 0, completed: 0 },
                blockers: [],
                updatedAt: '2026-10-21T08:00:00Z',
                closedAt: null,
                linkedPrs: [],
                slices: [],
            },
        ],
    }),
    searchTickets: async () => [],
    readTicket: async () => null,
    observeTicket: async () => ({ state: 'open' }),
    abandon: async () => null,
};

test("a logged-out az and a missing azure-devops extension each name their fix, and another repository's items still show", async () => {
    const failing = {
        'logged out': fakeAz({
            items: SPRINT,
            fail: () => new Error("az boards iteration failed: ERROR: Please run 'az login' to setup account."),
        }),
        'no extension': fakeAz({
            items: SPRINT,
            fail: (args) =>
                args[0] === 'boards'
                    ? new Error(
                          "az boards iteration failed: ERROR: 'boards' is misspelled or not recognized by the system.",
                      )
                    : undefined,
        }),
    };
    const expected = {
        'logged out': { repo: REPO, problem: 'az is logged out.', fix: 'az login' },
        'no extension': {
            repo: REPO,
            problem: 'az has no azure-devops extension.',
            fix: 'az extension add --name azure-devops',
        },
    };

    for (const [name, az] of Object.entries(failing)) {
        const source = mergeSources(
            new Map([
                ['acme/ios', otherRepo],
                [REPO, azureSprint([REPO], TEAM, az.run)],
            ]),
        );
        const read = await source.read();

        assert.deepEqual(
            read.items.map((i) => i.repo),
            ['acme/ios'],
            name,
        );
        assert.deepEqual(read.problems, [expected[name as keyof typeof expected]], name);
    }
});

test("a work item's linked PRs show their state from az repos pr show, a draft as open, with no checks; a deleted PR is left out", async () => {
    const pr = (pullRequestId: number, status: FakePr['status'], more: Partial<FakePr> = {}): FakePr => ({
        pullRequestId,
        status,
        sourceRefName: 'refs/heads/x',
        ...more,
    });
    const az = fakeAz({
        items: [
            { id: 1, type: 'User Story', state: 'Active', prs: [41, 42, 43, 44, 45] },
            { id: 11, type: 'Task', state: 'Active', parent: 1, prs: [41] },
        ],
        pullRequests: [
            pr(41, 'active'),
            pr(42, 'active', { isDraft: true, mergeStatus: 'conflicts' }),
            pr(43, 'completed', { closedDate: '2026-10-22T09:00:00Z', description: 'Closes it' }),
            pr(44, 'abandoned', { mergeStatus: 'rejectedByPolicy' }),
        ],
    });
    const [story] = (await azureSprint([REPO], TEAM, az.run).read()).items;
    const url = (id: number) => `${REPO_URL}/pullrequest/${id}`;

    assert.deepEqual(story!.linkedPrs, [
        {
            number: 41,
            url: url(41),
            state: 'open',
            isDraft: false,
            body: '',
            mergedAt: null,
            checks: null,
            mergeState: 'can merge',
        },
        {
            number: 42,
            url: url(42),
            state: 'open',
            isDraft: true,
            body: '',
            mergedAt: null,
            checks: null,
            mergeState: 'conflicts',
        },
        {
            number: 43,
            url: url(43),
            state: 'merged',
            isDraft: false,
            body: 'Closes it',
            mergedAt: '2026-10-22T09:00:00Z',
            checks: null,
            mergeState: 'can merge',
        },
        {
            number: 44,
            url: url(44),
            state: 'closed',
            isDraft: false,
            body: '',
            mergedAt: null,
            checks: null,
            mergeState: 'blocked',
        },
    ]);

    // One az repos pr show per PR, however many items link it.
    const shows = az.calls.filter((c) => c.slice(0, 3).join(' ') === 'repos pr show');

    assert.deepEqual(
        shows
            .map((c) => c[c.indexOf('--id') + 1])
            .map(String)
            .sort(),
        ['41', '42', '43', '44', '45'],
    );
    assert.ok(shows.every((c) => c[c.indexOf('--org') + 1] === 'https://dev.azure.com/contoso'));
});
