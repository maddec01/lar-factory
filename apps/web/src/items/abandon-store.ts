// The item Abandon's confirm dialog asks about, and its step: Abandon itself, then for ticketed work whether to close
// its ticket too. It keeps the item while the dialog closes, so the question doesn't change under the closing animation.

import { create } from 'zustand';
import type { Item } from '@lar-factory/shared';

interface AbandonState {
  open: boolean;
  item: Item | null;
  step: 'abandon' | 'close-ticket';
  ask: (item: Item) => void;
  /** Asks whether to close the ticket of work Abandon set aside. */
  askClose: (item: Item) => void;
  close: () => void;
}

export const useAbandonStore = create<AbandonState>()((set) => ({
  open: false,
  item: null,
  step: 'abandon',
  ask: (item) => set({ open: true, item, step: 'abandon' }),
  askClose: (item) => set({ open: true, item, step: 'close-ticket' }),
  close: () => set({ open: false }),
}));
