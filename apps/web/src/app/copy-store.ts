// What the copy-status live region says, so screen readers hear that a Copy button copied.

import { create } from 'zustand';

interface CopyState {
  announcement: string;
  announce: () => void;
}

export const useCopyStore = create<CopyState>()((set) => ({
  announcement: '',
  announce: () => {
    // Cleared first, so a second copy is read out again.
    set({ announcement: '' });
    setTimeout(() => set({ announcement: 'Copied' }), 50);
  },
}));
