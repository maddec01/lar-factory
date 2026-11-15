// buttonKind at the density of the surface a control sits on (ButtonDensityProvider in ButtonDensity.tsx).

import { useContext } from 'react';

import { DensityContext, TintContext } from './ButtonDensityContext';
import { type ButtonKind, buttonKind, type DangerKind, type dangerRecipe, type KindProps, recipe } from './ButtonKinds';

/** buttonKind at the surface's density, as a function of the kind and its danger tone: `kind('main')`, or
 *  `kind('other', 'danger')` for the quiet-destructive one. */
interface KindAtDensity {
    <K extends ButtonKind>(kind: K): KindProps<K, (typeof recipe)[K]>;
    <K extends DangerKind>(kind: K, tone: 'danger'): KindProps<K, (typeof dangerRecipe)[K]>;
}

/** buttonKind at the surface's density (ButtonDensityProvider, `sm` outside one). Inside TintedActions every kind but
 *  an App control takes the brand tint, keeping its `data-kind`; a danger tone keeps its own recipe. */
export function useButtonKind(): KindAtDensity {
    const size = useContext(DensityContext);
    const tinted = useContext(TintContext);

    return ((kind: ButtonKind, tone?: 'danger') => {
        if (tone) return buttonKind(kind as DangerKind, { tone, size });

        const props = buttonKind(kind, { size });

        return tinted && kind !== 'control' ? { ...props, variant: recipe.start } : props;
    }) as KindAtDensity;
}
