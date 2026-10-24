// Start on Queued cards: what each Start this page ran is doing, and the model choice this
// browser last started with.

import { create } from 'zustand';
import { readChoice, storedChoice } from '@mux-factory/shared';
import type { ModelChoice, StartedThread } from '@mux-factory/shared';
import { setKey } from './action-store.ts';

/** Where this browser keeps the last model choice Start started with. */
const CHOICE_KEY = 'mux-board:model-choice';

/**
 * A Start in flight, refused or failed (`error`), possibly run (`uncertain`), or done. A closed
 * message leaves its phase, so a Start that may have run stays hidden.
 */
export type StartState =
  | { phase: 'pending' }
  | { phase: 'error' | 'uncertain'; message?: string }
  | { phase: 'started'; thread: StartedThread };

interface StartStoreState {
  starts: Record<string, StartState>;
  lastChoice: ModelChoice | undefined;
  /** Sets the item's Start, or clears it with `undefined`. */
  set: (itemId: string, start: StartState | undefined) => void;
  remember: (choice: ModelChoice | undefined) => void;
}

export const useStartStore = create<StartStoreState>()((set) => ({
  starts: {},
  lastChoice: readChoice(localStorage.getItem(CHOICE_KEY)),
  set: (itemId, start) => set((state) => ({ starts: setKey(state.starts, itemId, start) })),
  remember: (choice) => {
    localStorage.setItem(CHOICE_KEY, storedChoice(choice));
    set({ lastChoice: choice });
  },
}));

export const useStart = (itemId: string): StartState | undefined => useStartStore((state) => state.starts[itemId]);
