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

/** A card's actions on a work-map card, inside a row list or not: named and tinted, never the rows' icon-only form. */
export const CardActions = ({ children }: { children: ReactNode }) => (
    <ON_ROW.Provider value="card">
        <TintedActions>{children}</TintedActions>
    </ON_ROW.Provider>
);
