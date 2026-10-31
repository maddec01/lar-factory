import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { BoardData, Item, Status } from '@lar-factory/shared';
import { createBoardState } from './board-state.ts';

const item = (id: string, status: Status): Item => ({
  id, status, statuses: [status], content: 'ticket', revision: 0, kind: 'issue', parentId: null, number: 1, title: id, url: null, repo: 'maddec01/lar-factory', labels: [], state: 'open', closedAs: null,
  parent: null, subIssues: { total: 0, completed: 0 }, blockers: [], updatedAt: '2026-10-21T09:00:00Z', closedAt: null,
  linkedPrs: [], slices: [],
});

const empty = (): BoardData => ({ repos: [], refreshSeconds: 60, fetchedAt: null, error: null, items: [], firstRead: { step: 'repositories', running: [], settled: false }, modelChoices: [] });
const statuses = (data: BoardData) => data.items.map((i) => `${i.id}:${i.status}`);

test('a change stays until GitHub reports it, or for three reads at most', () => {
  const board = createBoardState(empty());
  board.applyRead([item('a', 'List')], board.revision(), (items) => items);
  board.showChanged(item('a', 'Queued'));
  for (let read = 1; read <= 2; read++) {
    board.applyRead([item('a', 'List')], board.revision(), (items) => items);
    assert.deepEqual(statuses(board.snapshot()), ['a:Queued'], `read ${read}`);
  }
  board.applyRead([item('a', 'List')], board.revision(), (items) => items);
  assert.deepEqual(statuses(board.snapshot()), ['a:List']);
});

test("a read that listed the item's source from an earlier read doesn't count toward giving up on its change", () => {
  const board = createBoardState(empty());
  board.showChanged(item('a', 'Queued'));
  assert.equal(board.changing('a'), true);
  for (let read = 1; read <= 5; read++) board.applyRead([item('a', 'List')], board.revision(), (items) => items, () => false);
  assert.deepEqual(statuses(board.snapshot()), ['a:Queued']);
  board.applyRead([item('a', 'Queued')], board.revision(), (items) => items);
  assert.equal(board.changing('a'), false);
});

test('a read that started before a change keeps the change', () => {
  const board = createBoardState(empty());
  const since = board.revision();
  board.showChanged(item('a', 'Queued'));
  for (let read = 0; read < 3; read++) board.applyRead([item('a', 'List')], since, (items) => items);
  assert.deepEqual(statuses(board.snapshot()), ['a:Queued']);
});

test('a removed item stays off the board while GitHub still lists it', () => {
  const board = createBoardState(empty());
  const pushed: string[][] = [];
  board.subscribe((data) => pushed.push(statuses(data)));
  board.applyRead([item('a', 'List'), item('b', 'List')], board.revision(), (items) => items);
  board.remove('a');
  board.showChanged(item('a', 'Queued'));
  board.applyRead([item('a', 'List'), item('b', 'List')], board.revision(), (items) => items);
  assert.equal(board.removed('a'), true);
  assert.deepEqual(statuses(board.snapshot()), ['b:List']);
  assert.deepEqual(pushed, [['b:List']], 'remove pushes; a change to a removed item does not');
});

test('a pick stays until a read shows the item with only the status picked', () => {
  const board = createBoardState(empty());
  const twice = { ...item('a', 'Shaping'), statuses: ['Shaping', 'Review'] } satisfies Item;
  board.applyRead([twice], board.revision(), (items) => items);
  board.showChanged(item('a', 'Shaping'));
  board.applyRead([twice], board.revision(), (items) => items);
  assert.deepEqual(board.snapshot().items[0]!.statuses, ['Shaping'], 'the read still shows both');
  board.applyRead([item('a', 'Shaping')], board.revision(), (items) => items);
  board.applyRead([twice], board.revision(), (items) => items);
  assert.deepEqual(board.snapshot().items[0]!.statuses, ['Shaping', 'Review'], 'confirmed, so the board trusts later reads');
});

test('a newer provider read brings back an issue reopened after Abandon', () => {
  const board = createBoardState(empty());
  const original = item('a', 'List');
  board.applyRead([original], board.revision(), (items) => items);
  const olderRead = board.revision();
  board.remove('a');
  const reopened = { ...original, updatedAt: '2026-10-21T10:00:00Z' };
  board.applyRead([reopened], olderRead, (items) => items);
  assert.deepEqual(statuses(board.snapshot()), [], 'a read already in flight cannot undo Abandon');
  board.applyRead([reopened], board.revision(), (items) => items, () => false);
  assert.deepEqual(statuses(board.snapshot()), [], 'a cached source cannot undo Abandon');
  board.applyRead([reopened], board.revision(), (items) => items);
  assert.deepEqual(statuses(board.snapshot()), ['a:List']);
  assert.equal(board.removed('a'), false);
});
