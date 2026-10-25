// The notices' Recheck: asks the server to look t3 and gh up again, and keeps what it found
// while the tool problems are still the ones it answered, so an old note never heads a new notice.

import { flushSync } from 'react-dom';
import { create } from 'zustand';
import type { BoardData } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { postAction, receive } from '../items/card-actions.ts';
import { refocus } from './toasts.tsx';

/** A Recheck's answer: the error when it failed, else null, and the tool problems it left, serialised. */
interface RecheckAnswer {
  error: string | null;
  tools: string;
}

const toolsOf = (data: BoardData) => JSON.stringify(data.tools ?? {});

interface RecheckState {
  /** Set while this page's Recheck runs. */
  checking: boolean;
  /** Set once this page's Recheck answered, while the tool problems are the ones it answered. */
  answer: RecheckAnswer | undefined;
  recheck: () => Promise<void>;
}

export const useRecheckStore = create<RecheckState>()((set, get) => ({
  checking: false,
  answer: undefined,
  recheck: async () => {
    if (get().checking) return;
    set({ checking: true });
    const result = await postAction('/api/recheck', {});
    flushSync(() => {
      receive(result);
      set({ checking: false, answer: { error: result.error, tools: toolsOf(useBoardStore.getState().data) } });
    });
    // The button was disabled while checking, which dropped its focus.
    refocus(['[data-recheck]']);
  },
}));

// New board data from the server answers a failed Recheck's "can't reach" too, so its note goes;
// a note that found a problem goes once the problems change.
useBoardStore.subscribe((state, prev) => {
  if (state.data === prev.data) return;
  const { answer } = useRecheckStore.getState();
  if (answer && (answer.error || answer.tools !== toolsOf(state.data))) useRecheckStore.setState({ answer: undefined });
});
