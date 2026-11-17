// Whether actions sit on a stage row, where Start build and Open thread use their compact labels, or on a card, which
// keeps a row's tinted starts but names its thread link.

import { createContext, useContext } from 'react';

export const ON_ROW = createContext<boolean | 'card'>(false);

/** Truthy on a row or a card: starts take their compact, tinted form. */
export const useOnRow = () => Boolean(useContext(ON_ROW));
