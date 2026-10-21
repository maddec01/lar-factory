import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItem } from '../src/github.ts';
import type { RawItem, RawLinkedPr } from '../src/github.ts';

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
      parent: { number: 60, title: 'P', url: 'u', repository: { nameWithOwner: 'maddec01/mux-server' } },
      subIssuesSummary: { total: 3, completed: 1 },
      issueDependenciesSummary: { blockedBy: 2 },
      closedByPullRequestsReferences: { nodes: [{ number: 9, url: 'p', state: 'OPEN', isDraft: false }] },
    },
  };
  const item = normalizeItem(raw);
  assert.equal(item?.status, 'Needs you');
  assert.equal(item?.updatedAt, '2026-10-21T08:10:00Z');
  assert.deepEqual(item?.parent, { number: 60, title: 'P', url: 'u', repo: 'maddec01/mux-server' });
  assert.equal(item?.blockedBy, 2);
  assert.equal(item?.linkedPrs.length, 1);
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
