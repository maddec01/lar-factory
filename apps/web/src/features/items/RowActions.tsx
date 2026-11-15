import type { ReactNode } from 'react';
// The stage lists' actions: inside RowActions, on the stage rows and concept parts, Start build reads Start and Open thread
// is an icon with a tooltip. The desk and item details sit outside it and keep their words.

import { ON_ROW } from './RowContext';

export const RowActions = ({ children }: { children: ReactNode }) => (
    <ON_ROW.Provider value>{children}</ON_ROW.Provider>
);

/** A card's actions, on Your desk or a work-map card, inside a row list or not: named and outlined, never the rows'
 *  icon-only form. */
export const CardActions = ({ children }: { children: ReactNode }) => (
    <ON_ROW.Provider value="card">{children}</ON_ROW.Provider>
);
