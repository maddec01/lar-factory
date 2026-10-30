// What the board app's install state last said needs the User: Drift, Clashes and failed installs, and the User's
// Replace and Retry. It follows the state the app pushes while the page shows its warnings; outside the app there is none.

import { create } from 'zustand';
import { useInstallStore } from '../settings/install-store.ts';
import { boardApp, type InstallOperationResult, type InstallSnapshot } from '@lar-factory/shared';

interface DriftState {
  /** Each skill with Drift in any Install target, once. */
  skills: string[];
  /** Each skill a Clash blocks in an active target, with the paths that block it. */
  blocked: InstallSnapshot['blocked'];
  /** Why the last check failed: as a whole, without a path, or in each target at its path. */
  failures: Array<{ path?: string; reason: string }>;
  /** From Replace until the app answers it. */
  replacing: boolean;
  /** Why the last Replace failed. */
  error: string | null;
  /** From Retry until the app answers it. */
  retrying: boolean;
  /** Why the last Retry failed. */
  retryError: string | null;
  /** Reads the install state and follows the app's pushes; returns the function that stops following. */
  follow: () => () => void;
  /** Has the app overwrite the Drift with its Release. */
  replace: () => Promise<void>;
  /** Has the app check again, after the User moved a Clash away or to retry a failed target. */
  retry: () => Promise<void>;
}

/** The store's part of a snapshot. */
const fromSnapshot = (snapshot: InstallSnapshot): Pick<DriftState, 'skills' | 'blocked' | 'failures'> => ({
  skills: [...new Set(snapshot.drift.map(({ skill }) => skill))],
  blocked: snapshot.blocked,
  failures: [
    ...snapshot.error ? [{ reason: snapshot.error }] : [],
    ...snapshot.targets.flatMap(({ path, error }) => error ? [{ path, reason: error }] : []),
  ],
});

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useDriftStore = create<DriftState>()((set, get) => {
  /** Runs one of the app's operations while `busy` is set, keeping the snapshot it answers with and its error in `error`. */
  const operate = async (busy: 'replacing' | 'retrying', error: 'error' | 'retryError', call: () => Promise<InstallOperationResult>) => {
    const snapshot = useInstallStore.getState().snapshot;
    if (!snapshot?.installs || snapshot.running || get().replacing || get().retrying) return;
    set({ [busy]: true, [error]: null });
    try {
      const result = await call();
      useInstallStore.getState().accept(result.snapshot);
      const failures = fromSnapshot(result.snapshot).failures.map(({ path, reason }) => `${path ? `${path}: ` : ''}${reason}`);
      set({ [error]: result.error ?? (failures.length ? failures.join('; ') : null) });
    } catch (cause) {
      set({ [error]: failure(cause) });
    } finally {
      set({ [busy]: false });
    }
  };
  return {
    skills: [],
    blocked: [],
    failures: [],
    replacing: false,
    error: null,
    retrying: false,
    retryError: null,
    follow: () => {
      const apply = () => {
        const snapshot = useInstallStore.getState().snapshot;
        if (snapshot) set(fromSnapshot(snapshot));
      };
      const unsubscribe = useInstallStore.subscribe(apply);
      const unfollow = useInstallStore.getState().follow();
      apply();
      return () => { unsubscribe(); unfollow(); };
    },
    replace: () => operate('replacing', 'error', () => boardApp()!.replaceDrift()),
    retry: () => operate('retrying', 'retryError', () => boardApp()!.retryInstall()),
  };
});
