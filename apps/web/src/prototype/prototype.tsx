// PROTOTYPE, throwaway (branch prototype/companion-app). Question: what should the board look like as a
// companion app to T3 Code? Four app shells on the board page, switchable with ?variant=A|B|C|D|off, the
// bottom bar or ← →. All read the live board data; their buttons are stubs and write nothing.

import type { ReactNode } from 'react';
import { PrototypeSwitcher, useVariant } from './prototype-switcher.tsx';
import { VariantA } from './variant-a-twin.tsx';
import { VariantB } from './variant-b-lanes.tsx';
import { VariantC } from './variant-c-floor.tsx';
import { VariantD } from './variant-d-dock.tsx';

/** The chosen variant over the switcher, or the current board (`board`) when the choice is off. */
export function Prototype({ board }: { board: ReactNode }) {
  const variant = useVariant();
  return (
    <>
      {variant === 'A' ? <VariantA /> : variant === 'B' ? <VariantB /> : variant === 'C' ? <VariantC /> : variant === 'D' ? <VariantD /> : board}
      <PrototypeSwitcher />
    </>
  );
}
