// The item View item asked to see. The Board view jumps to it once it's showing.

import { create } from 'zustand';

interface JumpState {
  target: string | null;
  request: (itemId: string) => void;
  done: () => void;
}

export const useJumpStore = create<JumpState>()((set) => ({
  target: null,
  request: (itemId) => set({ target: itemId }),
  done: () => set({ target: null }),
}));
