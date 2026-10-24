// PROTOTYPE, throwaway (branch prototype/companion-app). Question: what should the board look like as a
// companion app to T3 Code? After trying A to D, the pick is E, "Control room": C's overview with A's
// detail. It reads the live board data; its buttons are stubs and write nothing.

import type { ReactNode } from 'react';
import { VariantE } from './variant-e-control.tsx';

/** The control room, or the current board (`board`) under Vitest, whose page tests drive it. */
export function Prototype({ board }: { board: ReactNode }) {
  return import.meta.env.MODE === 'test' ? board : <VariantE />;
}
