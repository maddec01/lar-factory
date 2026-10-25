// The item Abandon's confirm dialog asks about. It keeps the item while the dialog closes, so
// the question doesn't change under the closing animation.

import { create } from 'zustand';
import type { Item } from '@lar-factory/shared';

interface AbandonState {
  open: boolean;
  item: Item | null;
  ask: (item: Item) => void;
  close: () => void;
}

export const useAbandonStore = create<AbandonState>()((set) => ({
  open: false,
  item: null,
  ask: (item) => set({ open: true, item }),
  close: () => set({ open: false }),
}));
