// A persisted submission survives closing details or losing the server response.
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { writeHeaders, type BoardData, type Item, type TicketOptions } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { receive } from '../items/card-actions.ts';

export interface TicketPreview { title: string; description: string; revision: number }
interface Attempt {
  requestId: string;
  preview: TicketPreview;
  options: TicketOptions;
  phase: 'pending' | 'retry' | 'uncertain' | 'failed';
  message: string;
}
interface CreateTicketState {
  attempts: Record<string, Attempt>;
  submit(itemId: string, preview: TicketPreview, options: TicketOptions): Promise<void>;
}
export const useCreateTicketStore = create<CreateTicketState>()(persist((set, get) => ({
  attempts: {},
  submit: async (itemId, preview, options) => {
    const prior = get().attempts[itemId];
    if (prior?.phase === 'pending' || prior?.phase === 'uncertain') return;
    const attempt = prior?.phase === 'retry' ? prior : { requestId: crypto.randomUUID(), preview, options, phase: 'pending' as const, message: '' };
    const keep = (phase: Attempt['phase'], message: string) => set(state => ({ attempts: { ...state.attempts, [itemId]: { ...attempt, phase, message } } }));
    keep('pending', 'Creating issue…');
    useBoardStore.getState().beginWrite();
    try {
      const response = await fetch('/api/create-ticket', { method: 'POST', headers: writeHeaders(), body: JSON.stringify({ itemId,
        requestId: attempt.requestId, revision: attempt.preview.revision, preview: attempt.preview, options: attempt.options,
        session: useBoardStore.getState().data.capture?.session }) });
      const result = await response.json() as { item?: Item; board?: BoardData; error: string | null; uncertain?: boolean };
      if (result.item && result.board) {
        receive(result);
        set(state => { const attempts = { ...state.attempts }; delete attempts[itemId]; return { attempts }; });
      } else keep(result.uncertain ? 'uncertain' : 'failed', result.error ?? `Request failed (HTTP ${response.status}).`);
    } catch {
      keep('retry', 'The response was lost. Retry this submission to recover its result without creating another issue.');
    }
  },
}), {
  name: 'lar-board:create-ticket',
  partialize: ({ attempts }) => ({ attempts }),
  merge: (saved, current) => ({ ...current, attempts: Object.fromEntries(Object.entries((saved as Partial<CreateTicketState>).attempts ?? {}).map(([id, attempt]) =>
    [id, attempt.phase === 'pending' ? { ...attempt, phase: 'retry', message: 'The response was lost. Retry this submission to recover its result without creating another issue.' } : attempt])) }),
}));
