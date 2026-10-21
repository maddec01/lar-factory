import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeItem } from '../src/github.ts';
import type { RawItem } from '../src/github.ts';

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
