// The stage lists' actions: inside RowActions, on the stage rows and concept parts, Start build reads Start and Open thread
// is an icon with a tooltip. The desk and item details sit outside it and keep their words.

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

const ON_ROW = createContext(false);

export const RowActions = ({ children }: { children: ReactNode }) => (
    <ON_ROW.Provider value>{children}</ON_ROW.Provider>
);
export const useOnRow = () => useContext(ON_ROW);
