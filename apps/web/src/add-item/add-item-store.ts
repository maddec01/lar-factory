// The Add item dialog: whether it's open, which pane it shows, the draft's values, the submission's phase, the attempt
// it sends to /api/items, and what the dialog says about it. A retry resends the same attempt, so the server records
// the work once. Recorded work closes the dialog and shows the Added toast; so does a picked ticket, unless its record
// was on the board already, which then opens in the item dialog.

import { create } from 'zustand';
import { validateDraft, writeHeaders } from '@lar-factory/shared';
import type { CreationResult, ItemDraft, BoardData, TicketMatch } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { postAction, receive } from '../items/card-actions.ts';
import { notify } from '../notices/notices.tsx';

interface Attempt { requestId: string; session: string | undefined; draft: ItemDraft }

type Submission =
  | { phase: 'editing' | 'complete' }
  | { phase: 'pending' | 'retry' | 'uncertain'; attempt: Attempt };

/** New work, or a ticket to pick. */
export type AddItemPane = 'new' | 'pick';

/** The form's values as last edited, which a closed dialog keeps for the next opening. */
export interface DraftValues { repo: string; kind: string; title: string; description: string }

interface AddItemState {
  open: boolean;
  /** Opens or closes the dialog; opening after recorded work starts a new draft. */
  setOpen: (open: boolean) => void;
  pane: AddItemPane;
  setPane: (pane: AddItemPane) => void;
  submission: Submission;
  message: string;
  /** Counts the drafts started, so the form clears its fields for a new one. */
  draft: number;
  /** The draft's values once edited; null for a new draft. The form starts from them, so a draft survives a close. */
  values: DraftValues | null;
  /** Keeps the form's values as edited. */
  keep: (values: DraftValues) => void;
  /** Validates and sends the form's values, or resends the attempt that needs a retry. */
  submit: (values: unknown) => Promise<void>;
  /** Picks a ticket of `repo` into a work record: the error to show, or null once the dialog closed. */
  pick: (repo: string, ticket: TicketMatch) => Promise<string | null>;
  /** Clears what the dialog says while the draft is being edited. */
  edit: () => void;
  /** Starts a new draft. */
  reset: () => void;
}

const idle = (): string => (useBoardStore.getState().data.capture?.enabled === false ? 'Adding items is disabled in sample mode.' : '');

export const useAddItemStore = create<AddItemState>()((set, get) => ({
  open: false,
  pane: 'new',
  submission: { phase: 'editing' },
  message: idle(),
  draft: 0,
  values: null,
  keep: (values) => set({ values }),
  setOpen: (open) => {
    // Recorded work is done with; the next opening starts a new draft.
    if (open && get().submission.phase === 'complete') get().reset();
    set({ open });
  },
  setPane: (pane) => set({ pane }),
  edit: () => {
    if (get().submission.phase === 'editing') set({ message: '' });
  },
  reset: () => set((state) => ({ submission: { phase: 'editing' }, message: idle(), draft: state.draft + 1, values: null })),
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
        set({ message: (err as Error).message });
        return;
      }
    }
    set({ submission: { phase: 'pending', attempt }, message: retrying ? 'Finishing this submission…' : 'Adding it to List…' });
    // A poll that started before this write would bring older data than its answer.
    useBoardStore.getState().beginWrite();
    try {
      const response = await fetch('/api/items', { method: 'POST', headers: writeHeaders(), body: JSON.stringify(attempt) });
      const result = await response.json() as CreationResult & { uncertain?: boolean; board?: BoardData };
      if (result.item && result.board) {
        useBoardStore.getState().beginWrite();
        useBoardStore.getState().receive(result.board);
        // The page stays where it was; the Added toast's View item goes to the new item.
        set({ submission: { phase: 'complete' }, open: false });
        notify({ verb: 'Added', item: result.item, to: 'List' });
      } else {
        set({ submission: result.uncertain ? { phase: 'uncertain', attempt } : { phase: 'editing' },
          message: result.error ?? `Request failed (HTTP ${response.status}).` });
      }
    } catch {
      set({ submission: { phase: 'retry', attempt },
        message: 'The submission response was lost. Retry this submission to recover its result without adding it twice.' });
    }
  },
  pick: async (repo, ticket) => {
    const result = await postAction<CreationResult & { created: boolean }>('/api/pick-ticket', { repo, number: ticket.number });
    if (!result.item) return result.error ?? 'Could not pick the ticket.';
    receive(result);
    set({ open: false });
    if (result.created) notify({ verb: 'Added', item: result.item, to: 'List' });
    else useItemDialogStore.getState().open(result.item.id);
    return null;
  },
}));
