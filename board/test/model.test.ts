import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkState, countsOf, flowNodeOf, isRecentlyDone, isSlow, isStale, kindOf, trackOf, workCommand } from '../src/model.ts';
import type { BoardData, Checks, Item, Status } from '../src/model.ts';
import { esc, flowItems } from '../src/render.ts';

function item(status: Status, labels: string[] = [], extra: Partial<Item> = {}): Item {
  return {
    id: 'x',
    status,
    type: 'Issue',
    number: 7,
    title: 't',
    url: 'https://github.com/maddec01/mux-server/issues/7',
    repo: 'maddec01/mux-server',
    labels,
    state: 'OPEN',
    parent: null,
    subIssues: { total: 0, completed: 0 },
    blockedBy: 0,
    updatedAt: '2026-10-21T09:00:00Z',
    closedAt: null,
    linkedPrs: [],
    ...extra,
  };
}

test('fixed statuses map to one node each', () => {
  const cases: [Status, string][] = [
    ['List', 'capture'],
    ['Queued', 'queue'],
    ['Ready', 'gate'],
    ['In progress', 'build'],
    ['Review', 'review'],
    ['Verify', 'verify'],
    ['Ready to merge', 'ready-to-merge'],
    ['Done', 'merge'],
  ];
  for (const [status, node] of cases) {
    for (const labels of [[], ['bug'], ['concept'], ['decision: grill']]) {
      assert.equal(flowNodeOf(item(status, labels)), node, `${status} ${labels}`);
    }
  }
});

test('Shaping and Needs you go to the route box for the kind', () => {
  const cases: [string[], string][] = [
    [['bug'], 'clear'],
    [['feature'], 'decisions'],
    [['improvement'], 'decisions'],
    [[], 'decisions'],
    [['build'], 'decisions'],
    [['concept'], 'foggy'],
    [['decision: grill'], 'concept'],
    [['decision: prototype', 'feature'], 'concept'],
    [['decision: research'], 'concept'],
    [['decision: task'], 'concept'],
  ];
  for (const status of ['Shaping', 'Needs you'] as const) {
    for (const [labels, node] of cases) {
      assert.equal(flowNodeOf(item(status, labels)), node, `${status} ${labels}`);
    }
  }
});

test('kinds and tracks come from labels', () => {
  assert.equal(kindOf(item('List', ['bug', 'concept'])), 'concept');
  assert.equal(kindOf(item('List', [], { type: 'DraftIssue' })), 'draft');
  assert.equal(kindOf(item('List', [])), 'issue');
  assert.equal(trackOf(item('List', ['bug'])), 'bug');
  assert.equal(trackOf(item('List', ['build'])), 'fog');
  assert.equal(trackOf(item('List', ['decision: task'])), 'fog');
  assert.equal(trackOf(item('List', ['improvement'])), 'feat');
});

test('Done counts for 7 days after closing', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  assert.equal(isRecentlyDone(item('Done', [], { closedAt: '2026-10-15T10:00:00Z' }), now), true);
  assert.equal(isRecentlyDone(item('Done', [], { closedAt: '2026-10-13T10:00:00Z' }), now), false);
  assert.equal(isRecentlyDone(item('Review', [], { closedAt: '2026-10-21T09:00:00Z' }), now), false);
});

test('work command needs a repo and number', () => {
  assert.equal(workCommand(item('Queued')), '/mux-work maddec01/mux-server#7');
  assert.equal(workCommand(item('Queued', [], { type: 'DraftIssue', repo: null, number: null })), null);
});

const sample = JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8')) as BoardData;

test('stale when the last read failed or is too old', () => {
  const fresh = { ...sample, error: null, fetchedAt: '2026-10-21T09:59:00Z' };
  assert.equal(isStale(sample, Date.parse('2026-10-21T09:41:00Z')), true);
  assert.equal(isStale(fresh, Date.parse('2026-10-21T10:00:00Z')), false);
  assert.equal(isStale(fresh, Date.parse('2026-10-21T10:30:00Z')), true);
});

test('sample covers every status and both platforms', () => {
  const statuses = new Set(sample.items.map((i) => i.status));
  assert.equal(statuses.size, 10);
  const repos = new Set(sample.items.map((i) => i.repo));
  assert.ok(repos.has('maddec01/mux-server') && repos.has('maddec01/mux-apple'));
  assert.deepEqual(countsOf(sample), { total: 21, needsYou: 4, inFlight: 6, queued: 3, list: 4 });
});

test('flow tabs filter chips by issue type, and old Done items drop off', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  const all = flowItems(sample, 'all', now);
  assert.deepEqual(all.get('merge')?.map((i) => i.number), [5, 203]);
  const fog = flowItems(sample, 'fog', now);
  assert.deepEqual(fog.get('concept')?.map((i) => i.number), [201, 202]);
  assert.equal(fog.get('capture'), undefined);
  const bug = flowItems(sample, 'bug', now);
  assert.ok([...bug.values()].flat().every((i) => i.labels.includes('bug')));
});

test('escapes HTML', () => {
  assert.equal(esc(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
});

test('a running badge wins over failures until every check finishes, and turns slow after 30 minutes', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  const checks = (c: Partial<Checks>): Checks => ({ passed: 0, failed: 0, running: 0, total: 0, since: null, ...c });
  assert.equal(checkState(checks({ passed: 1, running: 1, failed: 1, total: 3 })), 'running');
  assert.equal(checkState(checks({ passed: 2, failed: 1, total: 3 })), 'failed');
  assert.equal(checkState(checks({ passed: 3, total: 3 })), 'passed');
  assert.equal(checkState(null), null);
  assert.equal(isSlow(checks({ running: 1, total: 1, since: '2026-10-21T09:31:00Z' }), now), false);
  assert.equal(isSlow(checks({ running: 1, total: 1, since: '2026-10-21T09:30:00Z' }), now), true);
  assert.equal(isSlow(checks({ passed: 1, total: 1, since: '2026-10-21T08:00:00Z' }), now), false, 'only a running pipeline is slow');
  assert.equal(isSlow(checks({ running: 1, total: 1 }), now), false);
});
