// Whether actions sit on a stage row, where Start build and Open thread use their compact labels, or on a card, which
// keeps a row's outlined starts but names its thread link.

import { createContext, useContext } from 'react';

export const ON_ROW = createContext<boolean | 'card'>(false);

/** Truthy on a row or a card: starts take their compact, outlined form. */
export const useOnRow = () => Boolean(useContext(ON_ROW));

/** On a stage row itself, where Open thread is an icon: not on a card. */
export const useOnRowItself = () => useContext(ON_ROW) === true;
