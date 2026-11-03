import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import type { BoardData, Item } from '@lar-factory/shared';
import { createBoardState } from './board-state.ts';
import { coalesced } from './coalesced.ts';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

test('a burst of triggers runs the work at once and makes one follow-up', () => {
  const work = vi.fn();
  const ask = coalesced(work, 500);
  for (let i = 0; i < 50; i++) ask();
  expect(work).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(500);
  expect(work).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(5_000);
  expect(work).toHaveBeenCalledTimes(2);
});

test('a lone trigger makes no follow-up, and a later one runs at once', () => {
  const work = vi.fn();
  const ask = coalesced(work, 500);
  ask();
  vi.advanceTimersByTime(600);
  expect(work).toHaveBeenCalledTimes(1);
  ask();
  expect(work).toHaveBeenCalledTimes(2);
});

test('a trigger just after a follow-up waits for the next gap, so runs stay apart', () => {
  const work = vi.fn();
  const ask = coalesced(work, 500);
  ask();
  ask();
  vi.advanceTimersByTime(500);
  ask();
  expect(work).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(500);
  expect(work).toHaveBeenCalledTimes(3);
});

const item = (id: string, status: Item['status']) => ({ id, status, statuses: [status], state: 'open', number: 1, updatedAt: '2026-11-03T00:00:00Z' }) as Item;

/** A board whose coalesced work shows `read()` as one read, and every board it pushes. */
function showingBoard(read: () => Item[]) {
  const board = createBoardState({ items: [] } as unknown as BoardData);
  const pushed: string[][] = [];
  board.subscribe((data) => pushed.push(data.items.map((i) => `${i.id} ${i.status}`)));
  const ask = coalesced(() => {
    board.applyRead(read(), board.revision(), (items) => items);
    board.push();
  }, 500);
  return { board, pushed, ask };
}

test('a start that lands between a show and its follow-up stays showing, though the records still say otherwise', () => {
  const { board, pushed, ask } = showingBoard(() => [item('a', 'Ready')]);
  ask();
  ask();
  board.showChanged(item('a', 'In progress'));
  vi.advanceTimersByTime(500);
  expect(board.find('a')?.status).toBe('In progress');
  expect(pushed.at(-1)).toEqual(['a In progress']);
});

test('a follow-up publishes one whole read, with what changed during the gap', () => {
  let read = [item('a', 'Ready'), item('b', 'Ready')];
  const { pushed, ask } = showingBoard(() => read);
  ask();
  ask();
  // Both items move together in the records, so no push may show one moved and not the other.
  read = [item('a', 'Review'), item('b', 'Review')];
  vi.advanceTimersByTime(500);
  expect(pushed).toEqual([['a Ready', 'b Ready'], ['a Review', 'b Review']]);
});
