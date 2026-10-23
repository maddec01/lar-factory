// What this page is doing for an item: a Queue, Back to List or Abandon in flight, or the error
// it left. Keyed by project item id, since a draft has no number.

import { create } from 'zustand';

export interface ItemAction {
  phase: 'pending' | 'error';
  kind: 'queue' | 'back-to-list' | 'abandon';
  message?: string;
}

interface ActionState {
  actions: Record<string, ItemAction>;
  /** Sets the item's action, or clears it with `undefined`. */
  set: (itemId: string, action: ItemAction | undefined) => void;
}

export const useActionStore = create<ActionState>()((set) => ({
  actions: {},
  set: (itemId, action) => set((state) => {
    const { [itemId]: _, ...rest } = state.actions;
    return { actions: action ? { ...rest, [itemId]: action } : rest };
  }),
}));

export const useItemAction = (itemId: string): ItemAction | undefined => useActionStore((state) => state.actions[itemId]);
