import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { buildSubIssueSearch, normalizeItem, normalizeItems, normalizeMergeState, rawDossiers, sliceLabelSearch } from './github-items.ts';
import type { RawIssueRef, RawItem, RawLinkedPr } from './github-items.ts';
import { rawIssue, sliceRef } from '../test/raw-items.ts';

/** A project issue in progress with the given sub-issues, counted in its summary. */
const withSubIssues = (id: string, number: number, labels: string[], subIssues: RawIssueRef[] = []): RawItem =>
  rawIssue(id, number, 'In progress', labels, { subIssuesSummary: { total: subIssues.length, completed: 0 }, subIssues: { nodes: subIssues } });

/** A sub-issue in another repo. */
const refIn = (repo: string, number: number, state: 'OPEN' | 'CLOSED'): RawIssueRef => ({ ...sliceRef(number, state), repository: { nameWithOwner: repo } });

/** Project issue 900 with the given labels and sub-issues. It is none of the sub-issues, so the searches look for all of them. */
const issue900 = (labels: string[], subIssues: RawIssueRef[]) => withSubIssues('PVTI_x', 900, labels, subIssues);

test('normalizes an issue item from the GraphQL response', () => {
  const raw: RawItem = {
    id: 'PVTI_1',
    updatedAt: '2026-10-21T08:09:14Z',
    status: { name: 'Needs you' },
    content: {
      __typename: 'Issue',
      number: 61,
      title: 'Arr instances',
      url: 'https://github.com/maddec01/lar-server/issues/61',
      state: 'OPEN',
      closedAt: null,
      updatedAt: '2026-10-21T08:10:00Z',
      repository: { nameWithOwner: 'maddec01/lar-server' },
      labels: { nodes: [{ name: 'feature' }] },
      parent: { number: 60, title: 'P', url: 'u', state: 'CLOSED', repository: { nameWithOwner: 'maddec01/lar-server' } },
      subIssuesSummary: { total: 3, completed: 1 },
      blockedBy: { nodes: [
        { number: 7, state: 'OPEN', repository: { nameWithOwner: 'maddec01/lar-server' } },
        { number: 8, state: 'OPEN', repository: { nameWithOwner: 'maddec01/lar-apple' } },
        { number: 5, state: 'CLOSED', repository: { nameWithOwner: 'maddec01/lar-server' } },
      ] },
      closedByPullRequestsReferences: { nodes: [{ number: 9, url: 'p', state: 'OPEN', isDraft: false, body: 'PR body' }] },
    },
  };
  const item = normalizeItem(raw);
  assert.equal(item?.status, 'Needs you');
  assert.equal(item?.updatedAt, '2026-10-21T08:10:00Z');
  assert.deepEqual(item?.parent, { number: 60, title: 'P', url: 'u', repo: 'maddec01/lar-server', state: 'CLOSED' });
  assert.equal(item && 'blockedBy' in item, false, 'the open count comes from the blockers, not a field of its own');
  assert.deepEqual(item?.blockers, [
    { number: 7, repo: 'maddec01/lar-server', state: 'OPEN' },
    { number: 8, repo: 'maddec01/lar-apple', state: 'OPEN' },
    { number: 5, repo: 'maddec01/lar-server', state: 'CLOSED' },
  ], 'the blocked-by issues come with their repo and state, closed ones too');
  assert.ok(!('blocking' in item!), 'the board reads no blocking links');
  assert.ok(!('map' in item!), 'only a concept has a map');
  assert.equal(item?.linkedPrs.length, 1);
  assert.equal(item?.linkedPrs[0]?.body, 'PR body', 'the stats block is kept from the body the board query reads');
});

test('an item blocked by nothing has no blockers, and a draft has none either', () => {
  assert.deepEqual(normalizeItem(rawIssue('PVTI_4', 4, 'List', ['feature']))?.blockers, []);
  assert.deepEqual(normalizeItem({ id: 'PVTI_5', updatedAt: '', status: null, content: { __typename: 'DraftIssue', title: 'Idea', updatedAt: '' } })?.blockers, []);
});

test("a concept's body becomes its map, and no other item keeps the body", () => {
  const body = '## Destination\nThere.\n\n## Fog\n- Why?\n';
  const concept = normalizeItem(rawIssue('PVTI_6', 6, 'Shaping', ['concept'], { body }));
  assert.deepEqual(concept?.map, { destination: 'There.', decisions: [], fog: ['Why?'] });
  assert.ok(!('body' in concept!), 'the page gets the parsed sections, not the raw body');
  const feature = normalizeItem(rawIssue('PVTI_7', 7, 'Shaping', ['feature'], { body }));
  assert.ok(!('map' in feature!) && !('body' in feature!));
});

/** Project issue `number`, a sub-issue of issue `parent`, in the same repo. */
const childOf = (number: number, parent: number) =>
  rawIssue(`PVTI_${number}`, number, 'Ready', ['build'], { parent: { ...sliceRef(parent, 'OPEN'), title: `Issue ${parent}` } });

test('an item with sub-issues on the board takes its map from its body, as a concept does; other items, and a body with no map sections, give none', () => {
  const body = '## Destination\nThere.\n\n## End-to-end check\nIt works\n1. Try it\n';
  const items = normalizeItems([
    rawIssue('PVTI_10', 10, 'In progress', ['feature'], { body }), childOf(11, 10),
    rawIssue('PVTI_12', 12, 'In progress', ['feature'], { body: 'Just a description.' }), childOf(13, 12),
    rawIssue('PVTI_14', 14, 'In progress', ['feature'], { body }),
  ]);
  const map = (id: string) => items.find((i) => i.id === id)?.map;
  assert.deepEqual(map('PVTI_10'), { destination: 'There.', decisions: [], fog: [], check: { title: 'It works', steps: ['Try it'] } });
  assert.equal(map('PVTI_12'), undefined, 'a parent whose body has no map sections has no map yet');
  assert.equal(map('PVTI_14'), undefined, 'no sub-issue on the board, so no dossier and no map');
  assert.ok(items.every((i) => !('body' in i)));
});

test("the dossiers' items, whose bodies the board reads: every concept, and every item with a sub-issue on the board, but not a build whose slices the project holds", () => {
  const raws = [
    rawIssue('PVTI_1', 1, 'Shaping', ['concept']),
    rawIssue('PVTI_10', 10, 'In progress', ['feature']), childOf(11, 10),
    withSubIssues('PVTI_20', 20, ['build'], [sliceRef(21, 'OPEN')]),
    rawIssue('PVTI_21', 21, 'In progress', ['improvement'], { parent: { ...sliceRef(20, 'OPEN'), title: 'Issue 20' } }),
    rawIssue('PVTI_30', 30, 'In progress', ['feature']),
  ];
  assert.deepEqual(rawDossiers(raws).map((r) => r.id), ['PVTI_1', 'PVTI_10']);
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

test("GitHub's content type, state and close reason become the item's content, state and closedAs", () => {
  const read = (content: NonNullable<RawItem['content']>) => {
    const item = normalizeItem({ id: 'PVTI_8', updatedAt: '2026-10-21T08:00:00Z', status: { name: 'Done' }, content });
    return item && [item.content, item.state, item.closedAs];
  };
  const issue = { __typename: 'Issue', number: 8, title: 'T', updatedAt: '2026-10-21T08:00:00Z' } as const;
  const pr = { ...issue, __typename: 'PullRequest' } as const;
  assert.deepEqual(read({ ...issue, state: 'OPEN', stateReason: 'REOPENED' }), ['ticket', 'open', null]);
  assert.deepEqual(read({ ...issue, state: 'CLOSED', stateReason: 'COMPLETED' }), ['ticket', 'closed', 'done']);
  assert.deepEqual(read({ ...issue, state: 'CLOSED', stateReason: null }), ['ticket', 'closed', 'done'], 'closed before GitHub kept a reason');
  assert.deepEqual(read({ ...issue, state: 'CLOSED', stateReason: 'NOT_PLANNED' }), ['ticket', 'closed', 'not-planned']);
  assert.deepEqual(read({ ...issue, state: 'CLOSED', stateReason: 'DUPLICATE' }), ['ticket', 'closed', 'not-planned']);
  assert.deepEqual(read({ ...pr, state: 'OPEN' }), ['pr', 'open', null]);
  assert.deepEqual(read({ ...pr, state: 'MERGED' }), ['pr', 'closed', 'done']);
  assert.deepEqual(read({ ...pr, state: 'CLOSED' }), ['pr', 'closed', 'not-planned']);
  assert.deepEqual(read({ __typename: 'DraftIssue', title: 'Idea', updatedAt: '2026-10-21T08:00:00Z' }), ['ticket', 'open', null]);
});

test("a linked PR's state is open, closed or merged", () => {
  const linked = (state: string) => normalizeItem(rawIssue('PVTI_9', 9, 'Review', [], {
    closedByPullRequestsReferences: { nodes: [{ number: 10, url: 'p', state, isDraft: false }] } }))?.linkedPrs[0]?.state;
  assert.deepEqual(['OPEN', 'CLOSED', 'MERGED'].map(linked), ['open', 'closed', 'merged']);
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

test("GitHub's merge state statuses map to can merge, checking, conflicts and blocked", () => {
  const states = Object.fromEntries(['CLEAN', 'HAS_HOOKS', 'UNSTABLE', 'UNKNOWN', 'DIRTY', 'BLOCKED', 'BEHIND', 'DRAFT']
    .map((status) => [status, normalizeMergeState(status)]));
  assert.deepEqual(states, { CLEAN: 'can merge', HAS_HOOKS: 'can merge', UNSTABLE: 'can merge', UNKNOWN: 'checking',
    DIRTY: 'conflicts', BLOCKED: 'blocked', BEHIND: 'blocked', DRAFT: 'blocked' });
  assert.equal(normalizeMergeState(undefined), 'checking', 'a status not read is still being checked');
  assert.deepEqual(['constructor', 'toString', '__proto__', 'NEW'].map(normalizeMergeState), ['checking', 'checking', 'checking', 'checking'],
    'an unknown status, even an object member, is checking');
});

test("a linked PR carries its merge state, and a pull request item its own checks and merge state", () => {
  const rollup = { contexts: { checkRunCountsByState: [{ state: 'SUCCESS', count: 2 }], statusContextCountsByState: [], nodes: [] } };
  const issue = normalizeItem({
    id: 'PVTI_6', updatedAt: '2026-10-21T08:00:00Z', status: { name: 'Verify' },
    content: { __typename: 'Issue', title: 'T', updatedAt: '2026-10-21T08:00:00Z',
      closedByPullRequestsReferences: { nodes: [{ number: 9, url: 'p', state: 'OPEN', isDraft: false, mergeStateStatus: 'DIRTY' }] } },
  });
  assert.equal(issue?.linkedPrs[0]?.mergeState, 'conflicts');
  assert.equal(issue?.pipeline, undefined, 'an issue has no pipeline of its own');
  const pr = normalizeItem({
    id: 'PVTI_7', updatedAt: '2026-10-21T08:00:00Z', status: { name: 'Verify' },
    content: { __typename: 'PullRequest', number: 7, title: 'P', updatedAt: '2026-10-21T08:00:00Z', isDraft: false,
      mergeStateStatus: 'CLEAN', statusCheckRollup: rollup },
  });
  assert.deepEqual(pr?.pipeline, { checks: { passed: 2, failed: 0, running: 0, total: 2, since: null }, mergeState: 'can merge' });
  assert.deepEqual(pr?.linkedPrs, []);
});

test("a build's slices come from the board query, open and closed, in GitHub's order; other kinds keep none", () => {
  const subIssues = [sliceRef(48, 'OPEN'), { ...sliceRef(46, 'CLOSED'), stateReason: 'COMPLETED' }, { ...sliceRef(45, 'CLOSED'), stateReason: 'NOT_PLANNED' },
    { ...sliceRef(47, 'OPEN'), stateReason: 'REOPENED' }, sliceRef(49, 'OPEN')];
  const issue = (labels: string[]) => normalizeItem(withSubIssues('PVTI_5', 5, labels, subIssues),
    { active: new Set(['maddec01/lar-factory#47', 'maddec01/lar-factory#49']), blocked: new Set(['maddec01/lar-factory#49']) });
  const slice = (number: number, state: 'OPEN' | 'CLOSED', progress: string) =>
    ({ number, title: `Issue ${number}`, url: sliceRef(number, state).url, repo: 'maddec01/lar-factory', state: state.toLowerCase(), progress });
  assert.deepEqual(issue(['build'])?.slices, [
    slice(48, 'OPEN', 'waiting'),
    slice(46, 'CLOSED', 'done'),
    slice(47, 'OPEN', 'active'),
    slice(49, 'OPEN', 'blocked'),
  ], 'a slice closed as not planned is hidden; blocked wins over active');
  assert.deepEqual(issue(['concept'])?.slices, [], "a concept's sub-issues are board items, not slices");
});

test('a slice closed as not planned is still no board item', () => {
  const dropped: RawIssueRef = { ...sliceRef(45, 'CLOSED'), stateReason: 'NOT_PLANNED' };
  const items = normalizeItems([withSubIssues('PVTI_build', 59, ['build'], [dropped]), withSubIssues('PVTI_45', 45, ['improvement'])]);
  assert.deepEqual(items.map((i) => i.id), ['PVTI_build']);
  assert.deepEqual(items[0]?.slices, []);
});

test('a build sub-issue the `build` search found is a board item and counts as a sub-issue, not a slice', () => {
  const builds = new Set(['maddec01/lar-factory#102']);
  const items = normalizeItems([
    withSubIssues('PVTI_parent', 100, ['build'], [sliceRef(101, 'OPEN'), sliceRef(102, 'OPEN')]),
    withSubIssues('PVTI_101', 101, ['improvement']),
    withSubIssues('PVTI_102', 102, ['build', 'improvement']),
  ], { builds });
  assert.deepEqual(items.map((i) => i.id), ['PVTI_parent', 'PVTI_102'], 'the slice is dropped, the build sub-issue stays');
  assert.deepEqual(items[0]?.slices.map((s) => s.number), [101]);
  assert.deepEqual(items[0]?.subIssues, { total: 1, completed: 0 }, "a build's sub-issue counter counts only its build sub-issues");
  assert.deepEqual(normalizeItems([withSubIssues('PVTI_p', 100, ['build'], [sliceRef(102, 'CLOSED')])], { builds })[0]?.subIssues, { total: 1, completed: 1 });
  assert.deepEqual(normalizeItems([withSubIssues('PVTI_c', 100, ['concept'], [sliceRef(102, 'OPEN')])], { builds })[0]?.subIssues, { total: 1, completed: 0 },
    'other kinds keep GitHub\'s counts');
});

test('active and blocked slices each come from one search over the repos of open slices, so the cost stays flat', () => {
  const raws = [
    issue900(['build'], [refIn('maddec01/lar-server', 1, 'OPEN'), refIn('maddec01/lar-factory', 2, 'OPEN'), refIn('maddec01/lar-apple', 3, 'CLOSED')]),
    issue900(['build'], [refIn('maddec01/lar-server', 4, 'OPEN')]),
    issue900(['concept'], [refIn('maddec01/lar-apple', 5, 'OPEN')]),
    issue900(['concept', 'build'], [refIn('maddec01/lar-apple', 6, 'OPEN')]),
  ];
  assert.equal(sliceLabelSearch('active', raws), 'is:issue is:open label:active repo:maddec01/lar-server repo:maddec01/lar-factory');
  assert.equal(sliceLabelSearch('blocked', raws), 'is:issue is:open label:blocked repo:maddec01/lar-server repo:maddec01/lar-factory');
  assert.equal(sliceLabelSearch('active', [issue900(['build'], [refIn('maddec01/lar-apple', 3, 'CLOSED')])]), null, 'no open slice, no search');
});

test("build sub-issues come from one search over the repos of the builds' sub-issues, open and closed", () => {
  assert.equal(buildSubIssueSearch([
    issue900(['build'], [refIn('maddec01/lar-server', 1, 'OPEN'), refIn('maddec01/lar-apple', 3, 'CLOSED')]),
    issue900(['build'], [refIn('maddec01/lar-server', 4, 'OPEN')]),
    issue900(['concept'], [refIn('maddec01/lar-factory', 5, 'OPEN')]),
  ]), 'is:issue label:build repo:maddec01/lar-server repo:maddec01/lar-apple');
  assert.equal(buildSubIssueSearch([issue900(['build'], [])]), null, 'no sub-issue, no search');
  const onProject = rawIssue('PVTI_1', 1, 'In progress', ['build'], { repository: { nameWithOwner: 'maddec01/lar-server' } });
  assert.equal(buildSubIssueSearch([issue900(['build'], [refIn('maddec01/lar-server', 1, 'OPEN')]), onProject]), null,
    'a sub-issue on the project is judged by its own labels, so it needs no search');
});
