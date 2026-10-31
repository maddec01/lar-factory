// The board data the page shows, the clock it reads ages against, and why the page can't
// reach the server, if it can't. It starts from the data the server put in the page.

import { useStartStore } from '../items/start-store.ts';
import { create } from 'zustand';
import type { BoardData } from '@lar-factory/shared';
import { refKey, sameRepo, stillReading } from '@lar-factory/shared';

interface BoardState {
  data: BoardData;
  /** The initial read completed in this page. Reconnecting never hides a board already loaded. */
  loaded: boolean;
  now: number;
  /** Set when the page can't reach the board server; it then keeps showing the last data. */
  clientError: string | null;
  /** Counts the page's own writes, so a poll that started before one doesn't show older data after it. */
  writes: number;
  receive: (data: BoardData, source?: 'live' | 'action') => void;
  fail: (message: string) => void;
  /** Moves the clock on, so ages and the stale banner change with no new data. */
  tick: () => void;
  beginWrite: () => void;
}

const initial = JSON.parse(document.getElementById('board-data')?.textContent ?? 'null') as BoardData;

export const useBoardStore = create<BoardState>()((set) => ({
  data: initial,
  loaded: initial?.firstRead?.settled ?? false,
  now: Date.now(),
  clientError: null,
  writes: 0,
  receive: (data, source = 'live') => set((state) => {
    // A restarted server sends its empty and partial first-read snapshots before its complete board. Keep the last
    // content visible, but accept the new session, warnings, settings and action results immediately.
    if (source === 'live' && state.loaded && !data.firstRead.settled) {
      // Before the first source lands the server has no waiting list yet. Afterwards only unread sources need cache.
      const beforeSources = data.firstRead.waiting === undefined && data.firstRead.step !== 'finishing';
      const cached = state.data.items.filter(item => (beforeSources || stillReading(data, item.repo))
        && (!data.repos.length || data.repos.some(repo => sameRepo(repo.repo, item.repo))));
      // Queueing gives a ticket a work ID, so its tracker identity must replace its former List row as well.
      const key = (item: BoardData['items'][number]) => item.number ? refKey(item.repo, item.number).toLowerCase() : item.id;
      const items = new Map(cached.map(item => [key(item), item]));
      for (const item of data.items) items.set(key(item), item);
      data = { ...data, items: [...items.values()], repos: data.repos.length ? data.repos : state.data.repos };
    }
    for (const [record, kind] of [['started', 'refine'], ['startedBuilds', 'build']] as const) {
      for (const id of Object.keys(state.data[record] ?? {})) {
        if (!data[record]?.[id]) useStartStore.getState().set(id, undefined, kind);
      }
    }
    return { data, loaded: state.loaded || data.firstRead.settled, now: Date.now(), clientError: null };
  }),
  fail: (message) => set({ now: Date.now(), clientError: message }),
  tick: () => set({ now: Date.now() }),
  beginWrite: () => set((state) => ({ writes: state.writes + 1 })),
}));
