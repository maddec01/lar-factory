// Start on Queued items and Start build on Ready ones: what each start this page ran is doing,
// and the model choice this browser last started with.

import { create } from 'zustand';
import { readChoice, storedChoice } from '@lar-factory/shared';
import type { ModelChoice, StartedThread } from '@lar-factory/shared';
import { setKey } from './action-store.ts';

/** Where this browser keeps the last model choice Start started with. */
const CHOICE_KEY = 'lar-board:model-choice';

/** Which start: today's Start, which refines a Queued item, or Start build on a Ready one. */
export type StartKind = 'refine' | 'build';

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
  /** Start builds, kept apart so an item refined on this page still offers its build. */
  builds: Record<string, StartState>;
  lastChoice: ModelChoice | undefined;
  /** Sets the item's Start or Start build, or clears it with `undefined`. */
  set: (itemId: string, start: StartState | undefined, kind?: StartKind) => void;
  remember: (choice: ModelChoice | undefined) => void;
}

export const useStartStore = create<StartStoreState>()((set) => ({
  starts: {},
  builds: {},
  lastChoice: readChoice(localStorage.getItem(CHOICE_KEY)),
  set: (itemId, start, kind = 'refine') => set((state) =>
    (kind === 'build' ? { builds: setKey(state.builds, itemId, start) } : { starts: setKey(state.starts, itemId, start) })),
  remember: (choice) => {
    localStorage.setItem(CHOICE_KEY, storedChoice(choice));
    set({ lastChoice: choice });
  },
}));

/** The item's Start, or its Start build. */
export const startOf = (state: StartStoreState, itemId: string, kind: StartKind = 'refine'): StartState | undefined =>
  (kind === 'build' ? state.builds : state.starts)[itemId];

export const useStart = (itemId: string, kind?: StartKind): StartState | undefined => useStartStore((state) => startOf(state, itemId, kind));
