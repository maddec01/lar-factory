// Which item the item dialog shows. Every list on the page opens the same dialog through it.

import { create } from 'zustand';

/** The item dialog while it's open: Radix marks the Modal's content `data-state="open"` until it closes. */
export const OPEN_ITEM_DIALOG = '[data-item-dialog][data-state="open"]';

interface ItemDialogState {
  /** The id of the item on show, or `null` while the dialog is closed. */
  itemId: string | null;
  session: number;
  fromList: boolean;
  dismiss: (() => void) | null;
  open: (itemId: string, fromList?: boolean) => void;
  close: () => void;
}

export const useItemDialogStore = create<ItemDialogState>()((set) => ({
  itemId: null,
  session: 0,
  fromList: false,
  dismiss: null,
  open: (itemId, fromList = false) => set((state) => ({ itemId, fromList, session: state.session + 1, dismiss: null })),
  close: () => set({ itemId: null }),
}));
