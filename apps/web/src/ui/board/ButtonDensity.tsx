// A surface's button density for the controls it holds that the board also shows elsewhere: Open thread, a pull
// request's link, Start and its split half, Move to List and Abandon sit on a row or a card at `sm` and in a dialog's
// footer at `md`. The surface says which (ButtonDensityProvider, such as DialogActions); the controls ask for their
// kind's props with useButtonKind, which takes the surface's size unless the call names one.

import type { ReactNode } from 'react';

import { DensityContext } from './ButtonDensityContext';
import type { ButtonDensity } from './ButtonKinds';

/** Sets the density of the button kinds inside it: `md` in a dialog's footer or a form, `sm` (the default) elsewhere. */
export function ButtonDensityProvider({
    density,
    children,
}: {
    /** The surface's density. */
    density: ButtonDensity;
    /** The surface's controls. */
    children: ReactNode;
}) {
    return <DensityContext.Provider value={density}>{children}</DensityContext.Provider>;
}
