// What the board app's install state last said needs the User: Drift, Clashes and failed installs, and the User's
// Replace and Retry. It follows the state the app pushes while the page shows its warnings; outside the app there is none.

import { create } from 'zustand';
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
const fromSnapshot = (snapshot: InstallSnapshot) => ({
  skills: [...new Set(snapshot.drift.map(({ skill }) => skill))],
  blocked: snapshot.blocked,
  failures: [
    ...snapshot.error ? [{ reason: snapshot.error }] : [],
    ...snapshot.targets.flatMap(({ path, error }) => error ? [{ path, reason: error }] : []),
  ],
});

/** The page reads the state once, however often the warning mounts; after that the pushes keep it current. */
let reading: Promise<unknown> | undefined;
let pushed = false;

const failure = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const useDriftStore = create<DriftState>()((set, get) => {
  /** Runs one of the app's operations while `busy` is set, keeping the snapshot it answers with and its error in `error`. */
  const operate = async (busy: 'replacing' | 'retrying', error: 'error' | 'retryError', call: () => Promise<InstallOperationResult>) => {
    if (get()[busy]) return;
    set({ [busy]: true, [error]: null });
    try {
      const result = await call();
      set({ ...fromSnapshot(result.snapshot), [error]: result.error ?? null });
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
      const app = boardApp();
      if (!app) return () => {};
      const stop = app.onInstallState((snapshot) => {
        pushed = true;
        set(fromSnapshot(snapshot));
      });
      // A push that lands before the read answers is newer, so the read doesn't overwrite it.
      reading ??= app.getInstallState().then((snapshot) => pushed || set(fromSnapshot(snapshot)), () => {});
      return stop;
    },
    replace: () => operate('replacing', 'error', () => boardApp()!.replaceDrift()),
    retry: () => operate('retrying', 'retryError', () => boardApp()!.retryInstall()),
  };
});
