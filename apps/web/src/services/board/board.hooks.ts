// The board data the page shows, the clock it reads ages against, and why the page can't
// reach the server, if it can't. It starts from the data the server put in the page.

import type { BoardData } from '@lar-factory/shared';
import { refKey, sameRepo, stillReading } from '@lar-factory/shared';
import { create } from 'zustand';

import { shareBoardData } from './share-board-data';

interface BoardState {
    data: BoardData;
    /** The board became usable in this page. Reconnecting never hides a board already loaded. */
    loaded: boolean;
    now: number;
    /** Set when the page can't reach the board server; it then keeps showing the last data. */
    clientError: string | null;
    /** Counts the page's own writes, so a poll that started before one doesn't show older data after it. */
    writes: number;
    /** Counts accepted server snapshots, even when their content is unchanged, for connection-recovery notices. */
    receives: number;
    receive: (data: BoardData, source?: 'live' | 'action') => void;
    fail: (message: string) => void;
    /** Moves the clock on, so ages and the stale banner change with no new data. */
    tick: () => void;
    beginWrite: () => void;
}

const initial = JSON.parse(document.getElementById('board-data')?.textContent ?? 'null') as BoardData;

export const useBoardStore = create<BoardState>()((set) => ({
    data: initial,
    loaded: Boolean(initial?.firstRead?.ready || initial?.firstRead?.settled),
    now: Date.now(),
    clientError: null,
    writes: 0,
    receives: 0,
    receive: (data, source = 'live') =>
        set((state) => {
            // A restarted server sends its empty and partial first-read snapshots before its complete board. Keep the last
            // content visible, but accept the new session, warnings, settings and action results immediately.
            if (source === 'live' && state.loaded) {
                // An empty waiting list before readiness is not a successful empty read. Failed sources also leave waiting.
                const beforeSources =
                    !data.firstRead.settled &&
                    !data.firstRead.ready &&
                    !data.firstRead.waiting?.length &&
                    data.firstRead.step !== 'finishing';
                const cached = state.data.items.filter(
                    (item) =>
                        (beforeSources ||
                            stillReading(data, item.repo) ||
                            data.itemSourceProblems?.some((problem) => sameRepo(problem.repo, item.repo))) &&
                        (!data.repos.length || data.repos.some((repo) => sameRepo(repo.repo, item.repo))),
                );
                // Queueing gives a ticket a work ID, so its tracker identity must replace its former List row as well.
                const key = (item: BoardData['items'][number]) =>
                    item.number ? refKey(item.repo, item.number).toLowerCase() : item.id;
                const items = new Map(cached.map((item) => [key(item), item]));

                for (const item of data.items) items.set(key(item), item);
                data = {
                    ...data,
                    items: [...items.values()],
                    repos: data.repos.length || (!beforeSources && !cached.length) ? data.repos : state.data.repos,
                };
            }

            data = shareBoardData(state.data, data);

            return {
                data,
                loaded: state.loaded || Boolean(data.firstRead.ready) || data.firstRead.settled,
                now: Date.now(),
                clientError: null,
                receives: state.receives + 1,
            };
        }),
    fail: (message) => set({ now: Date.now(), clientError: message }),
    tick: () => set({ now: Date.now() }),
    beginWrite: () => set((state) => ({ writes: state.writes + 1 })),
}));
