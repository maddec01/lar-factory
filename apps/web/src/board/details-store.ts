// Which disclosures the user opened or closed since the page loaded, so a re-render keeps them that way.

import { create } from 'zustand';

interface DetailsState {
  /** Open or closed, by disclosure id. */
  toggled: Record<string, boolean>;
  setOpen: (id: string, open: boolean) => void;
}

export const useDetailsStore = create<DetailsState>()((set) => ({
  toggled: {},
  setOpen: (id, open) => set((state) => ({ toggled: { ...state.toggled, [id]: open } })),
}));
