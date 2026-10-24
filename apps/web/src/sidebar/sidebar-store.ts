// Whether the sidebar shows, and the repository its group names scope the main area to.

import { create } from 'zustand';

interface SidebarState {
  open: boolean;
  toggle: () => void;
  /** The platform the main area shows, or `null` for the whole factory. */
  scope: string | null;
  setScope: (scope: string | null) => void;
}

export const useSidebarStore = create<SidebarState>()((set) => ({
  open: true,
  toggle: () => set((state) => ({ open: !state.open })),
  scope: null,
  setScope: (scope) => set({ scope }),
}));
