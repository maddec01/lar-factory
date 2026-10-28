import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { buildSubIssueSearches, normalizeItem, normalizeItems, normalizeMergeState, rawBuildPrs, rawDossiers, sliceLabelSearches } from './github-items.ts';
import type { RawIssueRef, RawItem, RawLinkedPr } from './github-items.ts';
import type { Item } from './model.ts';
import { rawIssue, sliceRef } from '../test/raw-items.ts';

/** An issue in progress with the given sub-issues, counted in its summary. */
const withSubIssues = (id: string, number: number, labels: string[], subIssues: RawIssueRef[] = []): RawItem =>
  rawIssue(id, number, 'In progress', labels, { subIssuesSummary: { total: subIssues.length, completed: 0 }, subIssues: { nodes: subIssues } });

/** A sub-issue in another repo. */
const refIn = (repo: string, number: number, state: 'OPEN' | 'CLOSED'): RawIssueRef => ({ ...sliceRef(number, state), repository: { nameWithOwner: repo } });

/** Issue 900 with the given labels and sub-issues. It is none of the sub-issues, so the searches look for all of them. */
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
      url: 'https://github.com/maddec01/lar-server/issues/61',
      state: 'OPEN',
      closedAt: null,
      updatedAt: '2026-10-21T08:10:00Z',
      repository: { nameWithOwner: 'maddec01/lar-server' },
      labels: { nodes: [{ name: 'feature' }, { name: 'status-needs-you' }] },
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
  assert.equal(item?.id, 'I_61', "an item's id is the issue's node id");
  assert.equal(item?.status, 'Needs you');
  assert.equal(item?.updatedAt, '2026-10-21T08:10:00Z');
  assert.deepEqual(item?.parent, { number: 60, title: 'P', url: 'u', repo: 'maddec01/lar-server', state: 'closed' });
  assert.equal(item && 'blockedBy' in item, false, 'the open count comes from the blockers, not a field of its own');
  assert.deepEqual(item?.blockers, [
    { number: 7, repo: 'maddec01/lar-server', state: 'open' },
    { number: 8, repo: 'maddec01/lar-apple', state: 'open' },
    { number: 5, repo: 'maddec01/lar-server', state: 'closed' },
  ], 'the blocked-by issues come with their repo and state, closed ones too');
  assert.ok(!('blocking' in item!), 'the board reads no blocking links');
  assert.ok(!('map' in item!), 'only a concept has a map');
  assert.equal(item?.linkedPrs.length, 1);
  assert.equal(item?.linkedPrs[0]?.body, 'PR body', 'the stats block is kept from the body the board query reads');
});

test('an item blocked by nothing has no blockers, and a draft has none either', () => {
  assert.deepEqual(normalizeItem(rawIssue('I_4', 4, 'List', ['feature']))?.blockers, []);
});

test("a concept's body becomes its map, and no other item keeps the body", () => {
  const body = '## Destination\nThere.\n\n## Fog\n- Why?\n';
  const concept = normalizeItem(rawIssue('I_6', 6, 'Shaping', ['concept'], { body }));
  assert.deepEqual(concept?.map, { destination: 'There.', decisions: [], fog: ['Why?'] });
  assert.ok(!('body' in concept!), 'the page gets the parsed sections, not the raw body');
  const feature = normalizeItem(rawIssue('I_7', 7, 'Shaping', ['feature'], { body }));
  assert.ok(!('map' in feature!) && !('body' in feature!));
});

/** Issue `number`, a sub-issue of issue `parent`, in the same repo. */
const childOf = (number: number, parent: number) =>
  rawIssue(`I_${number}`, number, 'Ready', ['build'], { parent: { ...sliceRef(parent, 'OPEN'), title: `Issue ${parent}` } });

test('an item with sub-issues on the board takes its map from its body, as a concept does; other items, and a body with no map sections, give none', () => {
  const body = '## Destination\nThere.\n\n## End-to-end check\nIt works\n1. Try it\n';
  const items = normalizeItems([
    rawIssue('I_10', 10, 'In progress', ['feature'], { body }), childOf(11, 10),
    rawIssue('I_12', 12, 'In progress', ['feature'], { body: 'Just a description.' }), childOf(13, 12),
    rawIssue('I_14', 14, 'In progress', ['feature'], { body }),
  ]);
  const map = (id: string) => items.find((i) => i.id === id)?.map;
  assert.deepEqual(map('I_10'), { destination: 'There.', decisions: [], fog: [], check: { title: 'It works', steps: ['Try it'] } });
  assert.equal(map('I_12'), undefined, 'a parent whose body has no map sections has no map yet');
  assert.equal(map('I_14'), undefined, 'no sub-issue on the board, so no dossier and no map');
  assert.ok(items.every((i) => !('body' in i)));
});

test("the dossiers' items, whose bodies the board reads: every concept, and every item with a sub-issue on the board, but not a build whose slices the project holds", () => {
  const raws = [
    rawIssue('I_1', 1, 'Shaping', ['concept']),
    rawIssue('I_10', 10, 'In progress', ['feature']), childOf(11, 10),
    withSubIssues('I_20', 20, ['build'], [sliceRef(21, 'OPEN')]),
    rawIssue('I_21', 21, 'In progress', ['improvement'], { parent: { ...sliceRef(20, 'OPEN'), title: 'Issue 20' } }),
    rawIssue('I_30', 30, 'In progress', ['feature']),
  ];
  assert.deepEqual(rawDossiers(raws).map((r) => r.id), ['I_1', 'I_10']);
});

test("the linked PRs whose body and merge time the board reads: a build's, never another item's or a concept's", () => {
  const linked = (id: string): RawLinkedPr => ({ id, number: 1, url: `https://github.com/maddec01/lar-factory/pull/${id}`, state: 'OPEN', isDraft: false });
  const withPrs = (id: string, number: number, labels: string[], prs: RawLinkedPr[]) =>
    rawIssue(id, number, 'In progress', labels, { closedByPullRequestsReferences: { nodes: prs } });
  const raws = [
    withPrs('I_1', 1, ['build'], [linked('PR_1'), linked('PR_2')]),
    withPrs('I_2', 2, ['feature'], [linked('PR_3')]),
    withPrs('I_3', 3, ['build', 'concept'], [linked('PR_4')]),
    withPrs('I_4', 4, ['build'], [linked('PR_2')]),
  ];
  assert.deepEqual(rawBuildPrs(raws).map((pr) => pr.id), ['PR_1', 'PR_2', 'PR_2']);
});

test("a linked PR's state is open, closed or merged", () => {
  const linked = (state: string) => normalizeItem(rawIssue('I_9', 9, 'Review', [], {
    closedByPullRequestsReferences: { nodes: [{ number: 10, url: 'p', state, isDraft: false }] } }))?.linkedPrs[0]?.state;
  assert.deepEqual(['OPEN', 'CLOSED', 'MERGED'].map(linked), ['open', 'closed', 'merged']);
});

test("a linked PR's check rollup becomes counts over all checks and the earliest start", () => {
  const counts = (pairs: Record<string, number>) => Object.entries(pairs).map(([state, count]) => ({ state, count }));
  const pr = (statusCheckRollup: RawLinkedPr['statusCheckRollup']) => normalizeItem({
    id: 'I_4', updatedAt: '2026-10-21T08:00:00Z',
    content: { __typename: 'Issue', id: 'I_4', title: 'T', updatedAt: '2026-10-21T08:00:00Z',
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
    id: 'I_6', updatedAt: '2026-10-21T08:00:00Z',
    content: { __typename: 'Issue', id: 'I_6', title: 'T', updatedAt: '2026-10-21T08:00:00Z',
      closedByPullRequestsReferences: { nodes: [{ number: 9, url: 'p', state: 'OPEN', isDraft: false, mergeStateStatus: 'DIRTY' }] } },
  });
  assert.equal(issue?.linkedPrs[0]?.mergeState, 'conflicts');
  assert.equal(issue?.pipeline, undefined, 'an issue has no pipeline of its own');

});

test("a build's slices come from the board query, open and closed, in GitHub's order; other kinds keep none", () => {
  const subIssues = [sliceRef(48, 'OPEN'), { ...sliceRef(46, 'CLOSED'), stateReason: 'COMPLETED' }, { ...sliceRef(45, 'CLOSED'), stateReason: 'NOT_PLANNED' },
    { ...sliceRef(47, 'OPEN'), stateReason: 'REOPENED' }, sliceRef(49, 'OPEN')];
  const issue = (labels: string[]) => normalizeItem(withSubIssues('I_5', 5, labels, subIssues),
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
  const items = normalizeItems([withSubIssues('I_build', 59, ['build'], [dropped]), withSubIssues('I_45', 45, ['improvement'])]);
  assert.deepEqual(items.map((i) => i.id), ['I_59']);
  assert.deepEqual(items[0]?.slices, []);
});

test('a build sub-issue the `build` search found is a board item and counts as a sub-issue, not a slice', () => {
  const builds = new Set(['maddec01/lar-factory#102']);
  const items = normalizeItems([
    withSubIssues('I_parent', 100, ['build'], [sliceRef(101, 'OPEN'), sliceRef(102, 'OPEN')]),
    withSubIssues('I_101', 101, ['improvement']),
    withSubIssues('I_102', 102, ['build', 'improvement']),
  ], { builds });
  assert.deepEqual(items.map((i) => i.id), ['I_100', 'I_102'], 'the slice is dropped, the build sub-issue stays');
  assert.deepEqual(items[0]?.slices.map((s) => s.number), [101]);
  assert.deepEqual(items[0]?.subIssues, { total: 1, completed: 0 }, "a build's sub-issue counter counts only its build sub-issues");
  assert.deepEqual(normalizeItems([withSubIssues('I_p', 100, ['build'], [sliceRef(102, 'CLOSED')])], { builds })[0]?.subIssues, { total: 1, completed: 1 });
  assert.deepEqual(normalizeItems([withSubIssues('I_c', 100, ['concept'], [sliceRef(102, 'OPEN')])], { builds })[0]?.subIssues, { total: 1, completed: 0 },
    'other kinds keep GitHub\'s counts');
});

test('active and blocked slices each come from one search per repo of open slices', () => {
  const raws = [
    issue900(['build'], [refIn('maddec01/lar-server', 1, 'OPEN'), refIn('maddec01/lar-factory', 2, 'OPEN'), refIn('maddec01/lar-apple', 3, 'CLOSED')]),
    issue900(['build'], [refIn('maddec01/lar-server', 4, 'OPEN')]),
    issue900(['concept'], [refIn('maddec01/lar-apple', 5, 'OPEN')]),
    issue900(['concept', 'build'], [refIn('maddec01/lar-apple', 6, 'OPEN')]),
  ];
  assert.deepEqual(sliceLabelSearches('active', raws), ['is:issue is:open label:active repo:maddec01/lar-server', 'is:issue is:open label:active repo:maddec01/lar-factory']);
  assert.deepEqual(sliceLabelSearches('blocked', raws), ['is:issue is:open label:blocked repo:maddec01/lar-server', 'is:issue is:open label:blocked repo:maddec01/lar-factory']);
  assert.deepEqual(sliceLabelSearches('active', [issue900(['build'], [refIn('maddec01/lar-apple', 3, 'CLOSED')])]), [], 'no open slice, no search');
});

test("build sub-issues come from one search per repo of the builds' sub-issues, open and closed", () => {
  assert.deepEqual(buildSubIssueSearches([
    issue900(['build'], [refIn('maddec01/lar-server', 1, 'OPEN'), refIn('maddec01/lar-apple', 3, 'CLOSED')]),
    issue900(['build'], [refIn('maddec01/lar-server', 4, 'OPEN')]),
    issue900(['concept'], [refIn('maddec01/lar-factory', 5, 'OPEN')]),
  ]), ['is:issue label:build repo:maddec01/lar-server', 'is:issue label:build repo:maddec01/lar-apple']);
  assert.deepEqual(buildSubIssueSearches([issue900(['build'], [])]), [], 'no sub-issue, no search');
  const onProject = rawIssue('I_1', 1, 'In progress', ['build'], { repository: { nameWithOwner: 'maddec01/lar-server' } });
  assert.deepEqual(buildSubIssueSearches([issue900(['build'], [refIn('maddec01/lar-server', 1, 'OPEN')]), onProject]), [],
    'a sub-issue on the board is judged by its own labels, so it needs no search');
});

test("an issue from a repository's issues takes its statuses from its status labels, and shows by the first in flow order", () => {
  const fromLabels = (...labels: string[]) => pick(normalizeItem({ ...rawIssue('I_1', 1, '', labels), }, {}));
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
  assert.deepEqual(normalizeItems(raws, {}).map((i) => i.number), [4]);
});
