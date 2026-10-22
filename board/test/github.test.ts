import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ACTIVE_SLICES_QUERY, ITEMS_QUERY, activeSliceSearch, normalizeItem, normalizeItems } from '../src/github.ts';
import type { RawIssueRef, RawItem, RawLinkedPr } from '../src/github.ts';

test('normalizes an issue item from the GraphQL response', () => {
  const raw: RawItem = {
    id: 'PVTI_1',
    updatedAt: '2026-10-21T08:09:14Z',
    status: { name: 'Needs you' },
    content: {
      __typename: 'Issue',
      number: 61,
      title: 'Arr instances',
      url: 'https://github.com/maddec01/mux-server/issues/61',
      state: 'OPEN',
      closedAt: null,
      updatedAt: '2026-10-21T08:10:00Z',
      repository: { nameWithOwner: 'maddec01/mux-server' },
      labels: { nodes: [{ name: 'feature' }] },
      parent: { number: 60, title: 'P', url: 'u', state: 'CLOSED', repository: { nameWithOwner: 'maddec01/mux-server' } },
      subIssuesSummary: { total: 3, completed: 1 },
      issueDependenciesSummary: { blockedBy: 2 },
      blockedBy: { totalCount: 23, nodes: [
        { number: 50, title: 'Open blocker', url: 'b50', state: 'OPEN', repository: { nameWithOwner: 'maddec01/mux-server' } },
        { number: 4, title: 'Closed blocker', url: 'b4', state: 'CLOSED', repository: { nameWithOwner: 'maddec01/mux-apple' } },
      ] },
      blocking: { totalCount: 1, nodes: [
        { number: 62, title: 'Blocked one', url: 'b62', state: 'OPEN', repository: { nameWithOwner: 'maddec01/mux-server' } },
      ] },
      closedByPullRequestsReferences: { nodes: [{ number: 9, url: 'p', state: 'OPEN', isDraft: false, body: 'PR body' }] },
    },
  };
  const item = normalizeItem(raw);
  assert.equal(item?.status, 'Needs you');
  assert.equal(item?.updatedAt, '2026-10-21T08:10:00Z');
  assert.deepEqual(item?.parent, { number: 60, title: 'P', url: 'u', repo: 'maddec01/mux-server', state: 'CLOSED' });
  assert.equal(item?.blockedBy, 2, 'the badge keeps the open count from the summary');
  assert.deepEqual(item?.blockers, {
    total: 23,
    nodes: [
      { number: 50, title: 'Open blocker', url: 'b50', repo: 'maddec01/mux-server', state: 'OPEN' },
      { number: 4, title: 'Closed blocker', url: 'b4', repo: 'maddec01/mux-apple', state: 'CLOSED' },
    ],
  }, 'the list holds open and closed blockers, and its total comes from GitHub, not the summary');
  assert.deepEqual(item?.blocking, {
    total: 1,
    nodes: [{ number: 62, title: 'Blocked one', url: 'b62', repo: 'maddec01/mux-server', state: 'OPEN' }],
  });
  assert.equal(item?.linkedPrs.length, 1);
  assert.equal(item?.linkedPrs[0]?.body, 'PR body', 'the stats block is kept from the body the board query reads');
  assert.match(ITEMS_QUERY, /number url state isDraft body mergedAt\n/, 'linked PR bodies come with the board query, not a call per item');
});

test('drafts, unknown statuses and hidden content', () => {
  const draft = normalizeItem({
    id: 'PVTI_2',
    updatedAt: '2026-10-21T08:00:00Z',
    status: null,
    content: { __typename: 'DraftIssue', title: 'Idea', updatedAt: '2026-10-20T08:00:00Z' },
  });
  assert.equal(draft?.status, 'List');
  assert.equal(draft?.number, null);
  assert.equal(draft?.repo, null);
  assert.deepEqual(draft?.blockers, { total: 0, nodes: [] }, 'drafts have no dependency links');
  assert.deepEqual(draft?.blocking, { total: 0, nodes: [] });
  assert.equal(normalizeItem({ id: 'PVTI_3', updatedAt: '', status: null, content: null }), null);
});

test("a linked PR's check rollup becomes counts over all checks and the earliest start", () => {
  const counts = (pairs: Record<string, number>) => Object.entries(pairs).map(([state, count]) => ({ state, count }));
  const pr = (statusCheckRollup: RawLinkedPr['statusCheckRollup']) => normalizeItem({
    id: 'PVTI_4', updatedAt: '2026-10-21T08:00:00Z', status: { name: 'Review' },
    content: { __typename: 'Issue', title: 'T', updatedAt: '2026-10-21T08:00:00Z',
      closedByPullRequestsReferences: { nodes: [{ number: 9, url: 'p', state: 'OPEN', isDraft: false,
        statusCheckRollup }] } },
  })?.linkedPrs[0];
  assert.deepEqual(pr({
    contexts: {
      checkRunCountsByState: counts({ SUCCESS: 2, SKIPPED: 1, NEUTRAL: 0, IN_PROGRESS: 1, QUEUED: 1, FAILURE: 1, CANCELLED: 0 }),
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
  })?.checks, { passed: 4, failed: 1, running: 3, total: 8, since: '2026-10-21T09:48:00Z' }, 'since counts running checks only');
  assert.equal(pr({ contexts: { checkRunCountsByState: counts({ QUEUED: 1 }), statusContextCountsByState: [],
    nodes: [{ status: 'QUEUED', startedAt: null, checkSuite: { createdAt: '2026-10-21T09:00:00Z' } }] } })?.checks?.since,
  '2026-10-21T09:00:00Z', 'a check stuck in the queue is timed from its suite, so an offline runner turns amber');
  assert.equal(pr(null)?.checks, null, 'no checks, no rollup');
  assert.equal(pr({ contexts: { checkRunCountsByState: counts({ SUCCESS: 0 }), statusContextCountsByState: [], nodes: [] } })?.checks, null,
    'a rollup with nothing in it is no checks');
});

test("a build's slices come from the board query, open and closed, in GitHub's order; other kinds keep none", () => {
  assert.match(ITEMS_QUERY, /subIssues\(first: \d+\) \{ nodes \{ number title url state stateReason repository \{ nameWithOwner \} \} \}/,
    'the board query reads each slice\'s state reason; labels would cost 60 points there');
  const ref = (number: number, state: 'OPEN' | 'CLOSED', stateReason: string | null) =>
    ({ number, title: `Slice ${number}`, url: `s${number}`, state, stateReason, repository: { nameWithOwner: 'maddec01/mux-factory' } });
  const subIssues = { nodes: [ref(48, 'OPEN', null), ref(46, 'CLOSED', 'COMPLETED'), ref(45, 'CLOSED', 'NOT_PLANNED'), ref(47, 'OPEN', 'REOPENED')] };
  const issue = (labels: string[]) => normalizeItem({
    id: 'PVTI_5', updatedAt: '2026-10-21T08:00:00Z', status: { name: 'In progress' },
    content: { __typename: 'Issue', title: 'T', updatedAt: '2026-10-21T08:00:00Z',
      labels: { nodes: labels.map((name) => ({ name })) }, subIssues },
  }, new Set(['maddec01/mux-factory#47']));
  assert.deepEqual(issue(['build'])?.slices, [
    { number: 48, title: 'Slice 48', url: 's48', repo: 'maddec01/mux-factory', state: 'OPEN', progress: 'waiting' },
    { number: 46, title: 'Slice 46', url: 's46', repo: 'maddec01/mux-factory', state: 'CLOSED', progress: 'done' },
    { number: 47, title: 'Slice 47', url: 's47', repo: 'maddec01/mux-factory', state: 'OPEN', progress: 'active' },
  ], 'a slice closed as not planned is hidden');
  assert.deepEqual(issue(['concept'])?.slices, [], "a concept's sub-issues are board items, not slices");
});

test('a slice closed as not planned is still no board item', () => {
  const raw = (id: string, number: number, labels: string[], subIssues: RawIssueRef[] = []): RawItem => ({
    id, updatedAt: '2026-10-21T08:00:00Z', status: { name: 'In progress' },
    content: { __typename: 'Issue', number, title: `Issue ${number}`, url: `u${number}`, state: 'OPEN', updatedAt: '2026-10-21T08:00:00Z',
      repository: { nameWithOwner: 'maddec01/mux-factory' }, labels: { nodes: labels.map((name) => ({ name })) }, subIssues: { nodes: subIssues } },
  });
  const dropped: RawIssueRef = { number: 45, title: 'Issue 45', url: 'u45', state: 'CLOSED', stateReason: 'NOT_PLANNED', repository: { nameWithOwner: 'maddec01/mux-factory' } };
  const items = normalizeItems([raw('PVTI_build', 59, ['build'], [dropped]), raw('PVTI_45', 45, ['improvement'])]);
  assert.deepEqual(items.map((i) => i.id), ['PVTI_build']);
  assert.deepEqual(items[0]?.slices, []);
});

test('active slices come from one search over the repos of open slices, so the cost stays flat', () => {
  const ref = (repo: string, number: number, state: 'OPEN' | 'CLOSED'): RawIssueRef =>
    ({ number, title: 'S', url: 'u', state, stateReason: null, repository: { nameWithOwner: repo } });
  const raw = (labels: string[], subIssues: RawIssueRef[]): RawItem => ({
    id: 'PVTI_x', updatedAt: '', status: null,
    content: { __typename: 'Issue', title: 'T', updatedAt: '', labels: { nodes: labels.map((name) => ({ name })) }, subIssues: { nodes: subIssues } },
  });
  assert.equal(activeSliceSearch([
    raw(['build'], [ref('maddec01/mux-server', 1, 'OPEN'), ref('maddec01/mux-factory', 2, 'OPEN'), ref('maddec01/mux-apple', 3, 'CLOSED')]),
    raw(['build'], [ref('maddec01/mux-server', 4, 'OPEN')]),
    raw(['concept'], [ref('maddec01/mux-apple', 5, 'OPEN')]),
    raw(['concept', 'build'], [ref('maddec01/mux-apple', 6, 'OPEN')]),
  ]), 'is:issue is:open label:active repo:maddec01/mux-server repo:maddec01/mux-factory');
  assert.equal(activeSliceSearch([raw(['build'], [ref('maddec01/mux-apple', 3, 'CLOSED')])]), null, 'no open slice, no search');
  assert.match(ACTIVE_SLICES_QUERY, /search\(type: ISSUE, first: \d+, query: \$q\) \{ nodes \{ \.\.\. on Issue \{ number repository \{ nameWithOwner \} \} \} \}/);
});
