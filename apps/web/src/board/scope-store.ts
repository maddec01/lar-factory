// The Scope: the repository the board shows, which the title bar's Scope menu and the List modal's Scope board set.

import { create } from 'zustand';

interface ScopeState {
  /** The repository the main area shows, as a repository key, or `null` for all repositories. */
  scope: string | null;
  setScope: (scope: string | null) => void;
}

export const useScopeStore = create<ScopeState>()((set) => ({
  scope: null,
  setScope: (scope) => set({ scope }),
}));
