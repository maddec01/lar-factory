// One page-wide install snapshot for Settings and notifications. Reading and subscribing never starts installation.
import { create } from 'zustand';
import { boardApp, type InstallOverviewClosure, type InstallSnapshot } from '@lar-factory/shared';

interface InstallState {
  snapshot: InstallSnapshot | null;
  closingOverview: InstallOverviewClosure | null;
  accept: (snapshot: InstallSnapshot) => void;
  read: () => Promise<InstallSnapshot>;
  follow: () => () => void;
  closeOverview: (reason: InstallOverviewClosure) => void;
}

let following = false;
let pushes = 0;

export const useInstallStore = create<InstallState>()((set, get) => ({
  snapshot: null,
  closingOverview: null,
  accept: (snapshot) => {
    const previous = get().snapshot;
    if (previous?.revision !== undefined && snapshot.revision !== undefined && snapshot.revision < previous.revision) return;
    set({ snapshot });
  },
  closeOverview: (reason) => {
    const app = boardApp();
    const snapshot = get().snapshot;
    if (!app || !snapshot) return;
    // Hide at once and keep in-flight progress pushes hidden until the desktop acknowledges the decision.
    set({ closingOverview: reason });
    void app.closeInstallOverview(reason, snapshot.revision ?? 0).then((next) => {
      get().accept(next);
      set({ closingOverview: null });
    }).catch(() => {
      set({ closingOverview: null });
      void get().read().catch(() => {});
    });
  },
  read: async () => {
    const before = pushes;
    try {
      const snapshot = await boardApp()!.getInstallState();
      if (before === pushes) get().accept(snapshot);
      return get().snapshot!;
    } catch (cause) {
      if (before !== pushes && get().snapshot) return get().snapshot!;
      throw cause;
    }
  },
  follow: () => {
    const app = boardApp();
    if (!app) return () => {};
    if (!following) {
      following = true;
      // Keep the connection for this page's lifetime, including while Settings and warnings are hidden.
      app.onInstallState((snapshot) => { pushes++; get().accept(snapshot); });
      void get().read().catch(() => {});
    }
    return () => {};
  },
}));
