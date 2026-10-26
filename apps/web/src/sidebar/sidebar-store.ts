// Whether the sidebar shows, which T3's SidebarProvider reads and sets (sidebar.tsx), and the repository its group names scope the main area to.

import { create } from 'zustand';

interface SidebarState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** The repository the main area shows, as `owner/name` or Draft, or `null` for all repositories. */
  scope: string | null;
  setScope: (scope: string | null) => void;
}

export const useSidebarStore = create<SidebarState>()((set) => ({
  open: true,
  setOpen: (open) => set({ open }),
  scope: null,
  setScope: (scope) => set({ scope }),
}));
