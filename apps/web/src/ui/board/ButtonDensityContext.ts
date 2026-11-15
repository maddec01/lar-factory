// The surface's button density that ButtonDensityProvider sets and useButtonKind reads (ButtonDensity.tsx), and whether
// the surface tints its actions in the brand colour (TintedActions).

import { createContext } from 'react';

import type { ButtonDensity } from './ButtonKinds';

export const DensityContext = createContext<ButtonDensity>('sm');

export const TintContext = createContext(false);
