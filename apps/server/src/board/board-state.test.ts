import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { BoardData, Item, Status } from '@mux-factory/shared';
import { createBoardState } from './board-state.ts';

const item = (id: string, status: Status): Item => ({
  id, status, type: 'Issue', number: 1, title: id, url: null, repo: 'maddec01/mux-factory', labels: [], state: 'OPEN',
  parent: null, subIssues: { total: 0, completed: 0 }, blockedBy: 0, updatedAt: '2026-10-21T09:00:00Z', closedAt: null,
  linkedPrs: [], slices: [],
});

const empty = (): BoardData => ({ project: { title: 'Mux' }, repos: [], refreshSeconds: 60, fetchedAt: null, error: null, items: [], modelChoices: [] });
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
