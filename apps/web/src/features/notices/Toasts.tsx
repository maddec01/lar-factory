// The toast's content and focus destination, and the close button shared by toasts and inline failures.

import { DismissButton as DesignDismissButton } from '@lar-works/design-system';
import type { MouseEvent, ReactNode } from 'react';

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

/** The close button every failure and toast carries; `what` names what it closes for screen readers. `inline` sits in
 *  a line of text, after an error message. */
export function DismissButton({
    what,
    inline = false,
    onClick,
}: {
    what: string;
    inline?: boolean;
    onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
    return <DesignDismissButton label={`Dismiss${what}`} placement={inline ? 'inline' : 'corner'} onClick={onClick} />;
}
