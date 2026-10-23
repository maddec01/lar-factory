// The app updater's state, as the bridge last reported it: read once when the header mounts, then
// each state the app pushes. Null outside the app and until the first read.

import { create } from 'zustand';
import { boardApp, type UpdateState } from './board-app.ts';

interface UpdateStoreState {
  state: UpdateState | null;
  /** Reads the state and follows the app's pushes; returns the function that stops following. */
  follow: () => () => void;
}

export const useUpdateStore = create<UpdateStoreState>()((set) => ({
  state: null,
  follow: () => {
    const bridge = boardApp();
    if (!bridge) return () => {};
    let pushed = false;
    const stop = bridge.onUpdateState((state) => { pushed = true; set({ state }); });
    // A push that lands before the read answers is newer, so the read doesn't overwrite it.
    void bridge.getUpdateState().then((state) => pushed || set({ state }), () => {});
    return stop;
  },
}));
