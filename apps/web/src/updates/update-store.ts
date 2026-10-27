// The app updater's state, as the bridge last reported it: read once when the header mounts, then
// each state the app pushes. Null outside the app and until the first read. It also knows when an
// install runs: the app drains the board server first, which can take a while, then quits. Each action
// shows T3 Code's toasts, as SidebarUpdatePill's downloadLocalUpdate and installLocalUpdate do. The update pill and
// Settings › Updates both run the update's next step through `run`.

import { create } from 'zustand';
import { boardApp, type UpdateState } from '@lar-factory/shared';
import { getUpdateActionError, getUpdateInstallConfirmationMessage, resolveUpdateButtonAction } from './update-button-logic.ts';
import { errorMessage, showUpdateDownloadedToast, showUpdateNotDownloadedToast, toastUpdateError } from './update-toasts.tsx';

export interface UpdateStore {
  state: UpdateState | null;
  /** From the install click until the app quits, or until the install fails. */
  installing: boolean;
  /** From a `run` until the app answers it; another `run` meanwhile does nothing. */
  pending: boolean;
  /** Reads the state and follows the app's pushes; returns the function that stops following. */
  follow: () => () => void;
  /** Asks the app to check for an update now. */
  check: () => Promise<void>;
  /** Asks the app to download the available update. */
  download: () => Promise<void>;
  /** Asks in the app's native dialog to restart, as T3 does, then has the app install the downloaded update. A second
   *  call while one installs does nothing. */
  install: () => Promise<void>;
  /** The update's next step: downloads an available update, or installs a downloaded one. */
  run: () => Promise<void>;
}

/** Whether `state` ends an install: it failed, or there is no downloaded update to install. */
const endsInstall = (state: UpdateState) => state.errorContext === 'install' || state.status !== 'downloaded';

export const useUpdateStore = create<UpdateStore>()((set, get) => ({
  state: null,
  installing: false,
  pending: false,
  follow: () => {
    const bridge = boardApp();
    if (!bridge) return () => {};
    let pushed = false;
    const stop = bridge.onUpdateState((state) => {
      pushed = true;
      set({ state, ...(endsInstall(state) && { installing: false }) });
    });
    // A push that lands before the read answers is newer, so the read doesn't overwrite it.
    void bridge.getUpdateState().then((state) => pushed || set({ state }), () => {});
    return stop;
  },
  check: async () => {
    try {
      const result = await boardApp()!.checkForUpdate();
      if (!result.checked) {
        toastUpdateError('Could not check for updates', result.state.message ?? 'Automatic updates are not available in this build.');
      }
    } catch (error) {
      toastUpdateError('Could not check for updates', errorMessage(error, 'Update check failed.'));
    }
  },
  download: async () => {
    try {
      const result = await boardApp()!.downloadUpdate();
      if (!result.accepted) showUpdateNotDownloadedToast();
      if (result.completed) showUpdateDownloadedToast();
      const actionError = getUpdateActionError(result);
      if (actionError) toastUpdateError('Could not download update', actionError);
    } catch (error) {
      toastUpdateError('Could not start update download', errorMessage(error, 'An unexpected error occurred.'));
    }
  },
  install: async () => {
    const { state, installing } = get();
    if (installing || !state) return;
    try {
      if (!(await boardApp()!.confirmRestart(getUpdateInstallConfirmationMessage(state)))) return;
    } catch (error) {
      toastUpdateError('Could not confirm update', errorMessage(error, 'Update confirmation failed.'));
      return;
    }
    set({ installing: true });
    try {
      // A successful install quits the app, so the answer only comes when it didn't take or failed.
      const result = await boardApp()!.installUpdate();
      if (!result.accepted) {
        set({ installing: false });
        // Deliberately the downloaded toast, as T3's installLocalUpdate shows showDesktopUpdateDownloadedToast for a
        // refused install (SidebarUpdatePill.tsx at 9a391eb): the update is still there to install.
        showUpdateDownloadedToast();
        return;
      }
      if (endsInstall(result.state)) set({ installing: false });
      const actionError = getUpdateActionError(result);
      if (actionError) toastUpdateError('Could not install update', actionError);
    } catch (error) {
      set({ installing: false });
      toastUpdateError('Could not install update', errorMessage(error, 'An unexpected error occurred.'));
    }
  },
  run: async () => {
    const { state, pending, installing } = get();
    const action = state ? resolveUpdateButtonAction(state) : 'none';
    if (pending || installing || action === 'none') return;
    set({ pending: true });
    try {
      await (action === 'download' ? get().download() : get().install());
    } finally {
      set({ pending: false });
    }
  },
}));
