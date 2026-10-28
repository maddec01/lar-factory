// Reset in Settings › Repositories: the repository its confirmation names, and whether the server is resetting it,
// closing an onboarding PR and dropping the entry of a repository still onboarding, or opening the reset PR of an
// onboarded one. The confirmation closes once the board drops the repository, with a toast linking the reset PR it
// opened, and stays open with gh's message when Reset fails.

import { create } from 'zustand';
import { shownRepo } from '@lar-factory/shared';
import { postAction, receive } from '../items/card-actions.ts';
import { showPrToast } from '../notices/toasts.tsx';

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
    const result = await postAction<{ prUrl: string }>('/api/repositories/reset', { repo: reset.repo });
    receive(result);
    set({ reset: result.error ? { ...reset, resetting: false, error: result.error } : null });
    if (result.error || !result.prUrl) return;
    showPrToast({ slot: 'reset', what: ` reset PR for ${shownRepo(reset.repo)}`, prUrl: result.prUrl, label: `${shownRepo(reset.repo)}'s reset PR` });
  },
}));
