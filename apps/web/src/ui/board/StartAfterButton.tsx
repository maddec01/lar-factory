import { Button } from '@lar-works/design-system';
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';

const MAP_ACTION = createContext(false);

/** Fixed-height map cards keep prerequisite labels compact; parts and dialogs wrap the complete name. */
export function MapStartAction({ children }: { children: ReactNode }) {
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
