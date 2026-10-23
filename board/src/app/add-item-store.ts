// An Add item submission: its phase, the attempt it sends to /api/items, and what the dialog says
// about it. A retry resends the same attempt, so the server finishes one issue rather than making two.

import { create } from 'zustand';
import { validateDraft } from '../add-item.ts';
import type { CreationResult, ItemDraft } from '../add-item.ts';
import { ref } from '../model.ts';
import type { BoardData } from '../model.ts';
import { useBoardStore } from './board-store.ts';

interface Attempt { requestId: string; session: string | undefined; draft: ItemDraft }

export type Submission =
  | { phase: 'editing' | 'complete' }
  | { phase: 'pending' | 'retry' | 'uncertain'; attempt: Attempt };

export interface ResultMessage { text: string; url?: string; label?: string }

interface AddItemState {
  submission: Submission;
  message: ResultMessage;
  /** Counts the drafts started, so the form clears its fields for a new one. */
  draft: number;
  /** Validates and sends the form's values, or resends the attempt that needs a retry. */
  submit: (values: unknown) => Promise<void>;
  /** Clears what the dialog says while the draft is being edited. */
  edit: () => void;
  /** Starts a new draft. */
  reset: () => void;
}

const idle = (): ResultMessage => ({
  text: useBoardStore.getState().data.capture?.enabled === false ? 'Adding items is disabled in sample mode.' : '',
});

export const useAddItemStore = create<AddItemState>()((set, get) => ({
  submission: { phase: 'editing' },
  message: idle(),
  draft: 0,
  edit: () => {
    if (get().submission.phase === 'editing') set({ message: { text: '' } });
  },
  reset: () => set((state) => ({ submission: { phase: 'editing' }, message: idle(), draft: state.draft + 1 })),
  submit: async (values) => {
    const { submission } = get();
    if (submission.phase !== 'editing' && submission.phase !== 'retry') return;
    const retrying = submission.phase === 'retry';
    const { data } = useBoardStore.getState();
    let attempt: Attempt;
    if (retrying) attempt = submission.attempt;
    else {
      try {
        attempt = { requestId: crypto.randomUUID(), session: data.capture?.session, draft: validateDraft(values, data.repos) };
      } catch (err) {
        set({ message: { text: (err as Error).message } });
        return;
      }
    }
    set({ submission: { phase: 'pending', attempt },
      message: { text: retrying ? 'Finishing this submission…' : 'Creating the issue and adding it to List…' } });
    try {
      const response = await fetch('/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(attempt) });
      const result = await response.json() as CreationResult & { board?: BoardData };
      if (result.item && result.board) {
        useBoardStore.getState().receive(result.board);
        set({ submission: { phase: 'complete' }, message: {
          text: `Added ${ref(result.item)} ${result.item.title} to List.`, url: result.issueUrl ?? undefined, label: 'View created issue' } });
      } else {
        const created = result.issueUrl ? 'Issue created. ' : '';
        const retry = result.issueUrl ? ' Retry to finish this issue.' : '';
        set({
          submission: result.uncertain ? { phase: 'uncertain', attempt } : result.issueUrl ? { phase: 'retry', attempt } : { phase: 'editing' },
          message: {
            text: `${created}${result.error ?? `Request failed (HTTP ${response.status}).`}${retry}`,
            url: result.issueUrl ?? (result.uncertain ? `https://github.com/${attempt.draft.repo}/issues` : undefined),
            label: result.issueUrl ? 'View created issue' : 'Check repository issues',
          },
        });
      }
    } catch {
      set({ submission: { phase: 'retry', attempt },
        message: { text: 'The submission response was lost. Retry this submission to recover its result without creating another issue.' } });
    }
  },
}));
