// Which item the item dialog shows. Every list on the page opens the same dialog through it.

import { create } from 'zustand';

/** The item dialog while it's open: Base UI marks its popup `data-open` until it starts closing. */
export const OPEN_ITEM_DIALOG = '[data-item-dialog][data-open]';

interface ItemDialogState {
  /** The project item id of the item on show, or `null` while the dialog is closed. */
  itemId: string | null;
  open: (itemId: string) => void;
  close: () => void;
}

export const useItemDialogStore = create<ItemDialogState>()((set) => ({
  itemId: null,
  open: (itemId) => set({ itemId }),
  close: () => set({ itemId: null }),
}));
