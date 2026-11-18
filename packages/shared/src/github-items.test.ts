import assert from 'node:assert/strict';
import { expect, test } from 'vite-plus/test';

import { rawIssue, sliceRef } from '../test/raw-items.ts';
import { normalizeItem, normalizeItems, normalizeMergeState } from './github-items.ts';
import type { RawIssueRef, RawItem, RawLinkedPr } from './github-items.ts';
import type { Item } from './model.ts';

/** An issue in progress with the given sub-issues, counted in its summary. */
const withSubIssues = (id: string, number: number, labels: string[], subIssues: RawIssueRef[] = []): RawItem =>
    rawIssue(id, number, 'In progress', labels, {
        subIssuesSummary: { total: subIssues.length, completed: 0 },
        subIssues: { nodes: subIssues },
    });
const refIn = (repo: string, number: number, state: 'OPEN' | 'CLOSED'): RawIssueRef => ({
    ...sliceRef(number, state),
    repository: { nameWithOwner: repo },
});
const issue900 = (labels: string[], subIssues: RawIssueRef[]) => withSubIssues('I_x', 900, labels, subIssues);

/** The status an item shows by, and every status it carries. */
const pick = (item: Item | null) => item && [item.status, item.statuses];

test('normalizes an issue item from the GraphQL response', () => {
    const raw: RawItem = {
        id: 'I_1',
        updatedAt: '2026-10-21T08:09:14Z',

        content: {
            __typename: 'Issue',
            id: 'I_61',
            number: 61,
            title: 'Arr instances',
            url: 'https://github.com/acme/api/issues/61',
            state: 'OPEN',
            closedAt: null,
            updatedAt: '2026-10-21T08:10:00Z',
            repository: { nameWithOwner: 'acme/api' },
            labels: { nodes: [{ name: 'feature' }, { name: 'status-needs-you' }] },
            parent: {
                number: 60,
                title: 'P',
                url: 'u',
                state: 'CLOSED',
                repository: { nameWithOwner: 'acme/api' },
            },
            subIssuesSummary: { total: 3, completed: 1 },
            blockedBy: {
                nodes: [
                    { number: 7, state: 'OPEN', repository: { nameWithOwner: 'acme/api' } },
                    { number: 8, state: 'OPEN', repository: { nameWithOwner: 'acme/ios' } },
                    { number: 5, state: 'CLOSED', repository: { nameWithOwner: 'acme/api' } },
                ],
            },
            closedByPullRequestsReferences: {
                nodes: [{ number: 9, url: 'p', state: 'OPEN', isDraft: false, body: 'PR body' }],
            },
        },
    };
    const item = normalizeItem(raw);

    assert.equal(item?.id, 'I_61', "an item's id is the issue's node id");
    assert.equal(item?.status, 'Needs you');
    assert.equal(item?.updatedAt, '2026-10-21T08:10:00Z');
    assert.deepEqual(item?.parent, { number: 60, title: 'P', url: 'u', repo: 'acme/api', state: 'closed' });
    assert.equal(item && 'blockedBy' in item, false, 'the open count comes from the blockers, not a field of its own');
    assert.deepEqual(
        item?.blockers,
        [
            { number: 7, repo: 'acme/api', state: 'open' },
            { number: 8, repo: 'acme/ios', state: 'open' },
            { number: 5, repo: 'acme/api', state: 'closed' },
        ],
        'the blocked-by issues come with their repo and state, closed ones too',
    );
    assert.ok(!('blocking' in item!), 'the board reads no blocking links');
    assert.ok(!('map' in item!), 'only a concept has a map');
    assert.equal(item?.linkedPrs.length, 1);
    assert.equal(item?.linkedPrs[0]?.body, 'PR body', 'the stats block is kept from the body the board query reads');
});

test("a linked PR's check rollup becomes counts over all checks and the earliest start", () => {
    const counts = (pairs: Record<string, number>) => Object.entries(pairs).map(([state, count]) => ({ state, count }));
    const pr = (statusCheckRollup: RawLinkedPr['statusCheckRollup']) =>
        normalizeItem({
            id: 'I_4',
            updatedAt: '2026-10-21T08:00:00Z',
            content: {
                ...rawIssue('I_4', 4, 'List', []).content!,
                closedByPullRequestsReferences: {
                    nodes: [{ number: 9, url: 'p', state: 'OPEN', isDraft: false, statusCheckRollup }],
                },
            },
        })?.linkedPrs[0];

    assert.deepEqual(
        pr({
            contexts: {
                checkRunCountsByState: counts({
                    SUCCESS: 2,
                    SKIPPED: 1,
                    NEUTRAL: 0,
                    IN_PROGRESS: 1,
                    QUEUED: 1,
                    FAILURE: 1,
                    CANCELLED: 0,
                }),
                statusContextCountsByState: counts({ SUCCESS: 1, PENDING: 1, ERROR: 0 }),
                nodes: [
                    { status: 'COMPLETED', startedAt: '2026-10-21T08:00:00Z' },
                    { status: 'IN_PROGRESS', startedAt: '2026-10-21T09:50:00Z' },
                    { status: 'QUEUED', startedAt: null, checkSuite: { createdAt: '2026-10-21T09:49:00Z' } },
                    { state: 'SUCCESS', createdAt: '2026-10-21T08:10:00Z' },
                    { state: 'PENDING', createdAt: '2026-10-21T09:48:00Z' },
                    {},
                ],
            },
        })?.checks,
        { passed: 4, failed: 1, running: 3, total: 8, since: '2026-10-21T09:48:00Z' },
        'since counts running checks only',
    );
    assert.equal(
        pr({
            contexts: {
                checkRunCountsByState: counts({ QUEUED: 1 }),
                statusContextCountsByState: [],
                nodes: [{ status: 'QUEUED', startedAt: null, checkSuite: { createdAt: '2026-10-21T09:00:00Z' } }],
            },
        })?.checks?.since,
        '2026-10-21T09:00:00Z',
        'a check stuck in the queue is timed from its suite, so an offline runner turns amber',
    );
    assert.equal(pr(null)?.checks, null, 'no checks, no rollup');
    assert.equal(
        pr({ contexts: { checkRunCountsByState: counts({ SUCCESS: 0 }), statusContextCountsByState: [], nodes: [] } })
            ?.checks,
        null,
        'a rollup with nothing in it is no checks',
    );
});

test("GitHub's merge state statuses map to can merge, checking, conflicts and blocked", () => {
    const states = Object.fromEntries(
        ['CLEAN', 'HAS_HOOKS', 'UNSTABLE', 'UNKNOWN', 'DIRTY', 'BLOCKED', 'BEHIND', 'DRAFT'].map((status) => [
            status,
            normalizeMergeState(status),
        ]),
    );

    assert.deepEqual(states, {
        CLEAN: 'can merge',
        HAS_HOOKS: 'can merge',
        UNSTABLE: 'can merge',
        UNKNOWN: 'checking',
        DIRTY: 'conflicts',
        BLOCKED: 'blocked',
        BEHIND: 'behind',
        DRAFT: 'blocked',
    });
    assert.equal(normalizeMergeState(undefined), 'checking', 'a status not read is still being checked');
    assert.deepEqual(
        ['constructor', 'toString', '__proto__', 'NEW'].map(normalizeMergeState),
        ['checking', 'checking', 'checking', 'checking'],
        'an unknown status, even an object member, is checking',
    );
});

test("a build's slices come from the board query, open and closed, in GitHub's order; other kinds keep none", () => {
    const subIssues = [
        sliceRef(48, 'OPEN'),
        { ...sliceRef(46, 'CLOSED'), stateReason: 'COMPLETED' },
        { ...sliceRef(45, 'CLOSED'), stateReason: 'NOT_PLANNED' },
        { ...sliceRef(47, 'OPEN'), stateReason: 'REOPENED' },
        sliceRef(49, 'OPEN'),
    ];
    const issue = (labels: string[]) => normalizeItem(withSubIssues('I_5', 5, labels, subIssues));
    const slice = (number: number, state: 'OPEN' | 'CLOSED', progress: string) => ({
        number,
        title: `Issue ${number}`,
        url: sliceRef(number, state).url,
        repo: 'maddec01/lar-factory',
        state: state.toLowerCase(),
        progress,
    });

    assert.deepEqual(
        issue(['build'])?.slices,
        [
            slice(48, 'OPEN', 'waiting'),
            slice(46, 'CLOSED', 'done'),
            slice(47, 'OPEN', 'waiting'),
            slice(49, 'OPEN', 'waiting'),
        ],
        'a slice closed as not planned is hidden',
    );
    assert.deepEqual(issue(['concept'])?.slices, [], "a concept's sub-issues are board items, not slices");
});

test('a build sub-issue the `build` search found is a board item and counts as a sub-issue, not a slice', () => {
    const builds = new Set(['maddec01/lar-factory#102']);
    const items = normalizeItems(
        [
            withSubIssues('I_parent', 100, ['build'], [sliceRef(101, 'OPEN'), sliceRef(102, 'OPEN')]),
            withSubIssues('I_101', 101, ['improvement']),
            withSubIssues('I_102', 102, ['build', 'improvement']),
        ],
        { builds },
    );

    assert.deepEqual(
        items.map((i) => i.id),
        ['I_100', 'I_102'],
        'the slice is dropped, the build sub-issue stays',
    );
    assert.deepEqual(
        items[0]?.slices.map((s) => s.number),
        [101],
    );
    assert.deepEqual(
        items[0]?.subIssues,
        { total: 1, completed: 0 },
        "a build's sub-issue counter counts only its build sub-issues",
    );
    assert.deepEqual(
        normalizeItems([withSubIssues('I_p', 100, ['build'], [sliceRef(102, 'CLOSED')])], { builds })[0]?.subIssues,
        { total: 1, completed: 1 },
    );
    assert.deepEqual(
        normalizeItems([withSubIssues('I_c', 100, ['concept'], [sliceRef(102, 'OPEN')])], { builds })[0]?.subIssues,
        { total: 1, completed: 0 },
        "other kinds keep GitHub's counts",
    );
});

test("an issue from a repository's issues takes its statuses from its status labels, and shows by the first in flow order", () => {
    const fromLabels = (...labels: string[]) => pick(normalizeItem({ ...rawIssue('I_1', 1, '', labels) }, {}));

    assert.deepEqual(fromLabels('status-shaping', 'feature'), ['Shaping', ['Shaping']]);
    assert.deepEqual(fromLabels('feature'), ['List', []]);
    assert.deepEqual(fromLabels('status-review', 'status-shaping'), ['Shaping', ['Shaping', 'Review']]);
    assert.deepEqual(fromLabels('status-ready-to-merge'), ['Ready to merge', ['Ready to merge']]);
    assert.deepEqual(fromLabels('status-done'), ['List', []], 'Done has no label');
});

test('an item closed as not planned is no board item, from either item source', () => {
    const raws = [
        rawIssue('I_1', 1, 'Review', ['status-review'], { state: 'CLOSED', stateReason: 'NOT_PLANNED' }),
        rawIssue('I_2', 2, 'Review', ['status-review'], { state: 'CLOSED', stateReason: 'DUPLICATE' }),
        rawIssue('I_4', 4, 'Review', ['status-review']),
    ];

    assert.deepEqual(
        normalizeItems(raws, {}).map((i) => i.number),
        [4],
    );
});

test('sub-issues make an issue linked only when they span repositories', () => {
    const flow = (subIssues: RawIssueRef[]) => normalizeItem(issue900([], subIssues))!.flow;

    expect(flow([refIn('maddec01/lar-factory', 901, 'OPEN')])).toBe('single');
    expect(flow([refIn('maddec01/lar-factory', 901, 'OPEN'), refIn('acme/web', 902, 'OPEN')])).toBe('linked');
});

test('a parent in another repository makes an issue linked', () => {
    const flow = (repo: string) =>
        normalizeItem(rawIssue('I_x', 900, 'Queued', [], { parent: refIn(repo, 800, 'OPEN') }))!.flow;

    expect(flow('maddec01/lar-factory')).toBe('single');
    expect(flow('acme/web')).toBe('linked');
});
