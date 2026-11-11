// The surface's button density that ButtonDensityProvider sets and useButtonKind reads (ButtonDensity.tsx).

import { createContext } from 'react';

import type { ButtonDensity } from './ButtonKinds';

export const DensityContext = createContext<ButtonDensity>('sm');
