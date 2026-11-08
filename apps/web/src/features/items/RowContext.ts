// Whether actions sit on a stage row, where Start build and Open thread use their compact labels.

import { createContext, useContext } from 'react';

export const ON_ROW = createContext(false);

export const useOnRow = () => useContext(ON_ROW);
