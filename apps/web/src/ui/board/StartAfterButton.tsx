import { Button } from '@lar-works/design-system';
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';

const MAP_ACTION = createContext(false);

/** Where a prerequisite's Start after keeps to one line, shortening its name, with the whole of it in its tooltip:
 *  a fixed-height map card, and a row's action slot, which must not grow its row; dialogs wrap the complete name. */
export function OneLineAction({ children }: { children: ReactNode }) {
    return <MAP_ACTION.Provider value>{children}</MAP_ACTION.Provider>;
}

/** A prerequisite control stays within its row and grows vertically to retain its complete label. */
export function StartAfterButton({ children, mark, ...props }: ComponentProps<typeof Button>) {
    const map = useContext(MAP_ACTION);

    return (
        <Button {...props} wrap={!map} shrinks={map} mark={map ? mark : undefined}>
            {children}
            {!map && mark ? ` ${mark}` : null}
        </Button>
    );
}
