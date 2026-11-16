import type { ReactNode } from 'react';
// The stage lists' actions: inside RowActions, on the stage rows and concept parts, Start build reads Start and Open thread
// is an icon with a tooltip. The desk and item details sit outside it and keep their words. Both surfaces tint their
// actions in the brand colour (TintedActions), so every hover action on a row or a map card looks the same.

import { ON_ROW } from './RowContext';
import { TintedActions } from '@/ui/board';

export const RowActions = ({ children }: { children: ReactNode }) => (
    <ON_ROW.Provider value>
        <TintedActions>{children}</TintedActions>
    </ON_ROW.Provider>
);

/** A card's actions on a work-map card, inside a row list or not: named, never the rows' icon-only form, and tinted
 *  unless `outlined`: a card that waits on you keeps its action outlined, as every amber card on Your desk does. */
export const CardActions = ({ children, outlined = false }: { children: ReactNode; outlined?: boolean }) => (
    <ON_ROW.Provider value="card">
        <TintedActions tinted={!outlined}>{children}</TintedActions>
    </ON_ROW.Provider>
);
