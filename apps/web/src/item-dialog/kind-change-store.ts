// The item dialog's kind change: one write through the board at a time per item, keeping what it answered. The record takes
// the kind only once the tracker has, so the row changes from the board the write answers with. A failure stays while the
// dialog is closed, so reopening the item still says what changed on the ticket and offers Retry. Answering a disagreement
// with no ticket write goes the same way.

import { flushSync } from 'react-dom';
import { create } from 'zustand';
import type { SwapKind } from '@lar-factory/shared';
import { postAction, receive } from '../items/card-actions.ts';
import { useItemDialogStore } from './item-dialog-store.ts';

interface KindChange {
  kind: SwapKind;
  saving: boolean;
  line: string;
  error: string | null;
}

interface KindAnswering {
  saving: boolean;
  error: string | null;
}

interface KindChangeState {
  changes: Record<string, KindChange>;
  answers: Record<string, KindAnswering>;
  start(itemId: string, kind: SwapKind): Promise<void>;
  /** Keeps both kinds, or gives the item `ticketKind`, the kind the user saw on the ticket. */
  answer(itemId: string, answer: 'keep' | 'update-item', ticketKind: SwapKind | null): Promise<void>;
}

export const useKindChangeStore = create<KindChangeState>((set, get) => ({
  changes: {},
  answers: {},
  async start(itemId, kind) {
    const before = get().changes[itemId];
    if (before?.saving) return;
    set(({ changes }) => ({ changes: { ...changes, [itemId]: { kind, saving: true, line: before?.line ?? '', error: null } } }));
    const result = await postAction<{ line: string; itemId: string }>('/api/item-kind', { itemId, kind });
    // An item with no record has one now, under its work ID, so the dialog follows it there.
    const shownId = result.itemId ?? itemId;
    // Each attempt says what it changed itself, so a failed retry keeps what the attempts before it changed.
    const earlier = result.error && before?.error && before.kind === kind ? before.line : '';
    const line = [earlier, result.line ?? ''].filter(Boolean).join(' ');
    flushSync(() => {
      set(({ changes: { [itemId]: _done, ...changes } }) => ({ changes: { ...changes, [shownId]: { kind, saving: false, line, error: result.error } } }));
      receive(result);
      if (shownId !== itemId && useItemDialogStore.getState().itemId === itemId) useItemDialogStore.getState().open(shownId);
    });
  },
  async answer(itemId, answer, ticketKind) {
    if (get().answers[itemId]?.saving) return;
    set(({ answers }) => ({ answers: { ...answers, [itemId]: { saving: true, error: null } } }));
    const result = await postAction('/api/item-kind-answer', { itemId, answer, ticketKind });
    flushSync(() => {
      set(({ answers }) => ({ answers: { ...answers, [itemId]: { saving: false, error: result.error } } }));
      receive(result);
    });
  },
}));
