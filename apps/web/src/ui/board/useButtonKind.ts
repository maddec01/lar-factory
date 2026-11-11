// buttonKind at the density of the surface a control sits on (ButtonDensityProvider in ButtonDensity.tsx).

import { useContext } from 'react';

import { DensityContext } from './ButtonDensityContext';
import {
    type ButtonKind,
    buttonKind,
    type DangerKind,
    type dangerRecipe,
    type KindProps,
    type recipe,
} from './ButtonKinds';

/** buttonKind at the surface's density, as a function of the kind and its danger tone: `kind('main')`, or
 *  `kind('other', 'danger')` for the quiet-destructive one. */
interface KindAtDensity {
    <K extends ButtonKind>(kind: K): KindProps<K, (typeof recipe)[K]>;
    <K extends DangerKind>(kind: K, tone: 'danger'): KindProps<K, (typeof dangerRecipe)[K]>;
}

/** buttonKind at the surface's density (ButtonDensityProvider, `sm` outside one). */
export function useButtonKind(): KindAtDensity {
    const size = useContext(DensityContext);

    return ((kind: ButtonKind, tone?: 'danger') =>
        tone ? buttonKind(kind as DangerKind, { tone, size }) : buttonKind(kind, { size })) as KindAtDensity;
}
