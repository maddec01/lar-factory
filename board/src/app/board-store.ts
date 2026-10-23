// The board data the page shows, the clock it reads ages against, and why the page can't
// reach the server, if it can't. It starts from the data the server put in the page.

import { create } from 'zustand';
import type { BoardData } from '../model.ts';

interface BoardState {
  data: BoardData;
  now: number;
  /** Set when the page can't reach the board server; it then keeps showing the last data. */
  clientError: string | null;
  receive: (data: BoardData) => void;
  fail: (message: string) => void;
  /** Moves the clock on, so ages and the stale banner change with no new data. */
  tick: () => void;
}

export const useBoardStore = create<BoardState>()((set) => ({
  data: JSON.parse(document.getElementById('board-data')?.textContent ?? 'null') as BoardData,
  now: Date.now(),
  clientError: null,
  receive: (data) => set({ data, now: Date.now(), clientError: null }),
  fail: (message) => set({ now: Date.now(), clientError: message }),
  tick: () => set({ now: Date.now() }),
}));
