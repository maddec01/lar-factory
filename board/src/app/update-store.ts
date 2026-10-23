// The board update this page follows: its own request to start one, the session the update began
// in, and since when the board has been away. A new session means the board restarted.

import { create } from 'zustand';
import type { BoardData } from '../model.ts';
import type { UpdateView } from '../update-view.ts';
import { useBoardStore } from './board-store.ts';
import { postAction, receive } from './card-actions.ts';
import { useDismissStore } from './dismiss-store.ts';

/** How long the board may stay away during an update before the page says it didn't restart. */
const RESTART_MS = 30_000;

interface Following {
  session: string | undefined;
  awaySince: number | null;
}

interface UpdateState {
  /** What the page knows that the server can't report: its own request, or a board that didn't come back. */
  view: UpdateView | null;
  following: Following | null;
  /** Asks the server to update, unless an update is starting or running. */
  start: () => Promise<void>;
  /** Follows a running update from the latest data; true when the board restarted, so the page should reload. */
  follow: (data: BoardData) => boolean;
  /** Takes in a failed poll; true when the update explains it, as the board goes away while it restarts. */
  away: () => boolean;
}

/** Whether an update is starting or running, so Update waits. */
export function updateBusy(data: BoardData, view: UpdateView | null): boolean {
  return view?.phase === 'starting' || (data.update?.state === 'running' && view?.phase !== 'lost');
}

/** Whether the page polls every second: while it follows an update the board hasn't lost. */
export function followsUpdate(state: Pick<UpdateState, 'view' | 'following'>): boolean {
  return state.following !== null && state.view?.phase !== 'lost';
}

export const useUpdateStore = create<UpdateState>()((set, get) => ({
  view: null,
  following: null,
  start: async () => {
    if (updateBusy(useBoardStore.getState().data, get().view)) return;
    set({ view: { phase: 'starting' } });
    const dismiss = useDismissStore.getState();
    dismiss.restore('refused');
    dismiss.restore('lost');
    const session = useBoardStore.getState().data.capture?.session;
    const result = await postAction('/api/update', {});
    receive(result);
    set(result.error ? { view: { phase: 'refused', message: result.error } } : { view: null, following: { session, awaySince: null } });
  },
  follow: (data) => {
    const { view, following } = get();
    // Back, or an update someone else started is running: either way this page's failure no longer holds.
    if (view?.phase === 'lost' || (view?.phase === 'refused' && data.update?.state === 'running')) set({ view: null });
    if (data.update?.state === 'running') {
      if (!following || following.awaySince !== null) set({ following: { session: following?.session ?? data.capture?.session, awaySince: null } });
      return false;
    }
    if (following) set({ following: null });
    return following !== null && following.session !== data.capture?.session;
  },
  away: () => {
    const { following } = get();
    if (!following) return false;
    const awaySince = following.awaySince ?? Date.now();
    set({ following: { ...following, awaySince } });
    if (Date.now() - awaySince > RESTART_MS) set({ view: { phase: 'lost' } });
    return true;
  },
}));
