// Whether the list modal is open. The title bar's List button and the board search both open it.

import { create } from 'zustand';

interface ListState {
    open: boolean;
    setOpen: (open: boolean) => void;
}

export const useListStore = create<ListState>()((set) => ({
    open: false,
    setOpen: (open) => set({ open }),
}));
