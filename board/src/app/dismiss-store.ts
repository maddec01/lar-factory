// The banners and toasts closed on this page, by key. A reload shows again whatever still holds.

import { create } from 'zustand';

interface DismissState {
  dismissed: ReadonlySet<string>;
  dismiss: (key: string) => void;
  /** Lets the banner with this key show again, such as when what it reports starts again. */
  restore: (key: string) => void;
}

export const useDismissStore = create<DismissState>()((set) => ({
  dismissed: new Set(),
  dismiss: (key) => set((state) => ({ dismissed: new Set(state.dismissed).add(key) })),
  restore: (key) => set((state) => {
    if (!state.dismissed.has(key)) return state;
    const dismissed = new Set(state.dismissed);
    dismissed.delete(key);
    return { dismissed };
  }),
}));

export const useDismissed = (key: string): boolean => useDismissStore((state) => state.dismissed.has(key));
