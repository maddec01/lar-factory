// Reset in Settings › Repositories on a repository still onboarding: the repository its confirmation names, and
// whether the server is closing its onboarding PR and dropping its entry. The confirmation closes once the board drops
// the onboarding, and stays open with gh's message when the close fails.

import { create } from 'zustand';
import { postAction, receive } from '../items/card-actions.ts';

interface Reset {
  repo: string;
  resetting: boolean;
  /** Why the last Reset failed, with gh's message. */
  error: string | null;
}

interface ResetState {
  reset: Reset | null;
  open: (repo: string) => void;
  close: () => void;
  confirm: () => Promise<void>;
}

export const useResetStore = create<ResetState>()((set, get) => ({
  reset: null,
  open: (repo) => set({ reset: { repo, resetting: false, error: null } }),
  close: () => {
    if (!get().reset?.resetting) set({ reset: null });
  },
  confirm: async () => {
    const { reset } = get();
    if (!reset || reset.resetting) return;
    set({ reset: { ...reset, resetting: true, error: null } });
    const result = await postAction('/api/onboarding/reset', { repo: reset.repo });
    receive(result);
    set({ reset: result.error ? { ...reset, resetting: false, error: result.error } : null });
  },
}));
