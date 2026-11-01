// The item dialog's kind change: one write through the board at a time per item, keeping what it answered. The record takes
// the kind only once the tracker has, so the row changes from the board the write answers with. A failure stays while the
// dialog is closed, so reopening the item still says what changed on the ticket and offers Retry.

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

interface KindChangeState {
  changes: Record<string, KindChange>;
  start(itemId: string, kind: SwapKind): Promise<void>;
}

export const useKindChangeStore = create<KindChangeState>((set, get) => ({
  changes: {},
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
}));
