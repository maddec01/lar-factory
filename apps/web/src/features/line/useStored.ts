// The per-dossier settings this browser remembers: whether a dossier is expanded and which view it shows.

import type { Item } from '@lar-factory/shared';
import { useState } from 'react';

export type View = 'list' | 'map';

/** A per-dossier setting this browser remembers. */
interface Stored<T> {
    name: string;
    read: (stored: string | null) => T;
    write: (value: T) => string;
}

export const OPEN: Stored<boolean> = { name: 'open', read: (s) => s === '1', write: (on) => (on ? '1' : '0') };
/** Work map or parts list; a dossier starts on its Work map. */
export const VIEW: Stored<View> = { name: 'view', read: (s) => (s === 'list' ? 'list' : 'map'), write: (v) => v };

export function useStored<T>({ name, read, write }: Stored<T>, parent: Item): [T, (v: T) => void] {
    const key = `lar-board:dossier-${name}:${parent.id}`;
    const [value, setValue] = useState(() => read(localStorage.getItem(key)));

    return [
        value,
        (v) => {
            localStorage.setItem(key, write(v));
            setValue(v);
        },
    ];
}
