// Start on Queued items and Start build on Ready ones: what this page alone knows of a start, and the
// model choice this browser last started with. The board data holds everything the server knows.

import { create } from 'zustand';
import { readChoice, storedChoice } from '@lar-factory/shared';
import type { ModelChoice, StartPurpose } from '@lar-factory/shared';
import { setKey } from './action-store.ts';

/** Where this browser keeps the last model choice Start started with. */
const CHOICE_KEY = 'lar-board:model-choice';

/** Which start: today's Start, which refines a Queued item, or Start build on a Ready one. */
export type StartKind = 'refine' | 'build';

/** What each start kind's thread does, as the board data names it. */
export const PURPOSE: Record<StartKind, StartPurpose> = { refine: 'shape', build: 'build' };

/**
 * A Start this page just pressed (`pending`), one the server never answered (`error`), or a May have started message
 * this page closed (`closed`).
 */
export type StartState =
  | { phase: 'pending' | 'closed' }
  | { phase: 'error'; message: string };

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
