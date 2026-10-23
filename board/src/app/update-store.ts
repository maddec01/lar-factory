// The app updater's state, as the bridge last reported it: read once when the header mounts, then
// each state the app pushes. Null outside the app and until the first read. It also knows when an
// install runs: the app drains the board server first, which can take a while, then quits. And it knows
// when the app refused a download or install, as a check ran.

import { create } from 'zustand';
import { boardApp, type UpdateState } from './board-app.ts';

export interface UpdateStore {
  state: UpdateState | null;
  /** From the install click until the app quits, or until the install fails. */
  installing: boolean;
  /** The app refused the last download or install, as another update action ran; until the next state or click. */
  busy: boolean;
  /** Reads the state and follows the app's pushes; returns the function that stops following. */
  follow: () => () => void;
  /** Asks the app to check for an update now. */
  check: () => Promise<void>;
  /** Asks the app to download the available update. */
  download: () => Promise<void>;
  /** Asks the app to install the downloaded update; a second call while one runs does nothing. */
  install: () => Promise<void>;
}

/** Whether `state` ends an install: it failed, or there is no downloaded update to install. */
const endsInstall = (state: UpdateState) => state.errorContext === 'install' || state.status !== 'downloaded';

export const useUpdateStore = create<UpdateStore>()((set, get) => ({
  state: null,
  installing: false,
  busy: false,
  follow: () => {
    const bridge = boardApp();
    if (!bridge) return () => {};
    let pushed = false;
    const stop = bridge.onUpdateState((state) => {
      pushed = true;
      set({ state, busy: false, ...(endsInstall(state) && { installing: false }) });
    });
    // A push that lands before the read answers is newer, so the read doesn't overwrite it.
    void bridge.getUpdateState().then((state) => pushed || set({ state }), () => {});
    return stop;
  },
  check: async () => {
    try {
      await boardApp()!.checkForUpdate();
    } catch {
      // The app checks again every 4 minutes.
    }
  },
  download: async () => {
    set({ busy: false });
    try {
      const { accepted } = await boardApp()!.downloadUpdate();
      if (!accepted) set({ busy: true });
    } catch {
      // The update stays available to retry.
    }
  },
  install: async () => {
    if (get().installing) return;
    set({ installing: true, busy: false });
    try {
      // A successful install quits the app, so the answer only comes when it didn't take or failed.
      const { accepted, state } = await boardApp()!.installUpdate();
      if (!accepted) set({ installing: false, busy: true });
      else if (endsInstall(state)) set({ installing: false });
    } catch {
      set({ installing: false });
    }
  },
}));
