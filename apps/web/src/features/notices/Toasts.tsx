// The toast's content and focus destination.

import type { ReactNode } from 'react';

export interface Toast {
    /** One toast per slot: a new one replaces the last. */
    slot: string;
    /** A failure is a red alert that stays until it's closed; a success is green and clears itself after 5 s. */
    failed?: boolean;
    /** Names the toast for its close button, such as "Moved #61". */
    what: string;
    body: ReactNode;
    /** Where keyboard focus goes when the toast closes while focus is in it: the first selector that matches. */
    focusAfter?: string[];
}
