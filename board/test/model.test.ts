import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkState, countsOf, isBuild, isRecentlyDone, isSlow, isStale, kindOf, sliceProgress, workMessage, workTitle } from '../src/model.ts';
import type { BoardData, Checks, Item, Status } from '../src/model.ts';
import { esc } from '../src/render.ts';

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
    blockers: { total: 0, nodes: [] },
    blocking: { total: 0, nodes: [] },
    updatedAt: '2026-10-21T09:00:00Z',
    closedAt: null,
    linkedPrs: [],
    slices: [],
    ...extra,
  };
}

test('a slice is done once closed as completed, active while open with the active label, else waiting; not planned is hidden', () => {
  assert.equal(sliceProgress('CLOSED', 'COMPLETED', false), 'done');
  assert.equal(sliceProgress('CLOSED', 'COMPLETED', true), 'done', 'a closed slice is done even if it still has active');
  assert.equal(sliceProgress('CLOSED', null, false), 'done', 'closed before GitHub kept a reason');
  assert.equal(sliceProgress('OPEN', null, true), 'active');
  assert.equal(sliceProgress('OPEN', 'REOPENED', false), 'waiting');
  assert.equal(sliceProgress('CLOSED', 'NOT_PLANNED', false), null);
  assert.equal(sliceProgress('CLOSED', 'NOT_PLANNED', true), null);
  assert.equal(sliceProgress('CLOSED', 'DUPLICATE', false), null, 'a duplicate is closed as not planned too');
});

test('kinds come from labels', () => {
  assert.equal(kindOf(item('List', ['bug', 'concept'])), 'concept');
  assert.equal(kindOf(item('List', [], { type: 'DraftIssue' })), 'draft');
  assert.equal(kindOf(item('List', [])), 'issue');
  assert.equal(kindOf(item('List', ['improvement', 'build'])), 'improvement', 'build only switches on slices');
  assert.equal(kindOf(item('List', ['build', 'bug'])), 'bug');
  assert.equal(kindOf(item('List', ['build', 'feature'])), 'feature');
  assert.equal(kindOf(item('List', ['build'])), 'build', 'with no other kind it reads as a build');
  assert.equal(kindOf(item('List', ['build', 'decision: research'])), 'decision');
});

test('the build label makes a build whatever the kind, except on a concept', () => {
  assert.equal(isBuild(item('List', ['build'])), true);
  assert.equal(isBuild(item('List', ['build', 'feature'])), true);
  assert.equal(isBuild(item('List', ['feature'])), false);
  assert.equal(isBuild(item('List', ['build', 'concept'])), false, "a concept's sub-issues are board items, not slices");
});

test('Done counts for 7 days after closing', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  assert.equal(isRecentlyDone(item('Done', [], { closedAt: '2026-10-15T10:00:00Z' }), now), true);
  assert.equal(isRecentlyDone(item('Done', [], { closedAt: '2026-10-13T10:00:00Z' }), now), false);
  assert.equal(isRecentlyDone(item('Review', [], { closedAt: '2026-10-21T09:00:00Z' }), now), false);
});

test('the work message titles the thread, then runs mux-work on the issue', () => {
  assert.equal(workMessage(item('Queued')), '#7 t\n$mux-work maddec01/mux-server#7');
  assert.equal(workTitle(item('Queued')), '#7 t');
  const draft = item('Queued', [], { type: 'DraftIssue', repo: null, number: null });
  assert.equal(workMessage(draft), null);
  assert.equal(workTitle(draft), null);
});

test('a $word in the title is kept and $mux-work still opens line 2', () => {
  const message = workMessage(item('Queued', [], { title: 'Fix $foo parsing' }))!;
  assert.equal(message, '#7 Fix $foo parsing\n$mux-work maddec01/mux-server#7');
  assert.equal(message.split('\n')[1], '$mux-work maddec01/mux-server#7');
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
