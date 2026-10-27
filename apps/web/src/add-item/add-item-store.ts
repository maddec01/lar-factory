// The Add item dialog: whether it's open, the draft's values, the submission's phase, the attempt it sends to
// /api/items, and what the dialog says about it. A retry resends the same attempt, so the server finishes one
// issue rather than making two. A created item closes the dialog and shows the Added toast.

import { create } from 'zustand';
import { onAzure, validateDraft, writeHeaders } from '@lar-factory/shared';
import type { CreationResult, ItemDraft, BoardData } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { notify } from '../notices/notices.tsx';

interface Attempt { requestId: string; session: string | undefined; draft: ItemDraft }

type Submission =
  | { phase: 'editing' | 'complete' }
  | { phase: 'pending' | 'retry' | 'uncertain'; attempt: Attempt };

export interface ResultMessage { text: string; url?: string; label?: string }

/** The form's values as last edited, which a closed dialog keeps for the next opening. */
export interface DraftValues { repo: string; kind: string; title: string; description: string; labels: string[]; onlyFor: boolean }

interface AddItemState {
  open: boolean;
  /** Opens or closes the dialog; opening after a created item starts a new draft. */
  setOpen: (open: boolean) => void;
  submission: Submission;
  message: ResultMessage;
  /** Counts the drafts started, so the form clears its fields for a new one. */
  draft: number;
  /** The draft's values once edited; null for a new draft. The form starts from them, so a draft survives a close. */
  values: DraftValues | null;
  /** Keeps the form's values as edited. */
  keep: (values: DraftValues) => void;
  /** Validates and sends the form's values, or resends the attempt that needs a retry. */
  submit: (values: unknown) => Promise<void>;
  /** Clears what the dialog says while the draft is being edited. */
  edit: () => void;
  /** Starts a new draft. */
  reset: () => void;
}

/** What a new item in `repo` is: an issue on GitHub, a work item on Azure DevOps. */
export const itemNoun = (repo: string | undefined): string => repo && onAzure(repo) ? 'work item' : 'issue';

/** Where to look for an item the board can't confirm it created: the repository's issues, or its Azure DevOps project's work items. */
function itemsLink(repo: string): Pick<ResultMessage, 'url' | 'label'> {
  if (!onAzure(repo)) return { url: `https://github.com/${repo}/issues`, label: 'Check repository issues' };
  const [organization, project] = repo.split('/');
  return { url: `https://dev.azure.com/${organization}/${project}/_workitems`, label: 'Check the project’s work items' };
}

const idle = (): ResultMessage => ({
  text: useBoardStore.getState().data.capture?.enabled === false ? 'Adding items is disabled in sample mode.' : '',
});

export const useAddItemStore = create<AddItemState>()((set, get) => ({
  open: false,
  submission: { phase: 'editing' },
  message: idle(),
  draft: 0,
  values: null,
  keep: (values) => set({ values }),
  setOpen: (open) => {
    // A finished item is done with; the next opening starts a new one.
    if (open && get().submission.phase === 'complete') get().reset();
    set({ open });
  },
  edit: () => {
    if (get().submission.phase === 'editing') set({ message: { text: '' } });
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
        set({ message: { text: (err as Error).message } });
        return;
      }
    }
    const noun = itemNoun(attempt.draft.repo);
    set({ submission: { phase: 'pending', attempt },
      message: { text: retrying ? 'Finishing this submission…' : `Creating the ${noun} and adding it to List…` } });
    // A poll that started before this write would bring older data than its answer.
    useBoardStore.getState().beginWrite();
    try {
      const response = await fetch('/api/items', { method: 'POST', headers: writeHeaders(),
        body: JSON.stringify(attempt) });
      const result = await response.json() as CreationResult & { board?: BoardData };
      if (result.item && result.board) {
        useBoardStore.getState().beginWrite();
        useBoardStore.getState().receive(result.board);
        // The page stays where it was; the Added toast's View item goes to the new item.
        set({ submission: { phase: 'complete' }, open: false });
        notify({ verb: 'Added', item: result.item, to: 'List' });
      } else {
        const created = result.issueUrl ? `${noun[0]!.toUpperCase()}${noun.slice(1)} created. ` : '';
        const retry = result.issueUrl ? ` Retry to finish this ${noun}.` : '';
        const text = `${created}${result.error ?? `Request failed (HTTP ${response.status}).`}${retry}`;
        set({
          submission: result.uncertain ? { phase: 'uncertain', attempt } : result.issueUrl ? { phase: 'retry', attempt } : { phase: 'editing' },
          message: result.issueUrl ? { text, url: result.issueUrl, label: `View created ${noun}` }
            : result.uncertain ? { text, ...itemsLink(attempt.draft.repo) } : { text },
        });
      }
    } catch {
      set({ submission: { phase: 'retry', attempt },
        message: { text: `The submission response was lost. Retry this submission to recover its result without creating another ${noun}.` } });
    }
  },
}));
