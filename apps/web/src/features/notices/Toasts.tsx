// Toasts, shown in the design system's notification stack: a success clears itself after 5 s, later while it's
// hovered or has focus; a failure stays until it's closed. One toast per slot, so a new one replaces the last. When a
// toast that had the keyboard focus closes, the focus moves on to the board's next control.

import { clearNotification, DismissButton as DesignDismissButton, showNotification } from '@lar-works/design-system';
import type { MouseEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';

import { OPEN_ITEM_DIALOG } from '@/features/item-dialog';

/** Where focus goes when a closed toast had it and names nowhere of its own. */
const FALLBACK_FOCUS = ['.add-item', '[data-add-item]', '.open-settings', '[data-slot="modal-close"]'];

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

const focusFirst = (selectors: string[]) => {
    // The item dialog holds focus while it's open, and its buttons share their data attributes with the board's.
    const root =
        document.querySelector(OPEN_ITEM_DIALOG) ??
        document.querySelector('[role="dialog"][data-state="open"]') ??
        document;

    // querySelector returns the first in page order; take the first selector that matches.
    selectors
        .map((sel) => root.querySelector<HTMLElement>(sel))
        .find(Boolean)
        ?.focus({ preventScroll: true });
};

/** Moves focus to the first of `selectors` on the page, or in the item dialog while it's open, if something took it away with the element that had it. */
export function refocus(selectors: string[]): void {
    // The item dialog's focus trap catches focus on the dialog itself when the element that had it goes.
    const lost =
        document.activeElement === document.body || document.activeElement === document.querySelector(OPEN_ITEM_DIALOG);

    if (lost) focusFirst(selectors);
}

/** Moves focus to the first of `next` that's on the page, or to the fallback. */
const focusAfterClose = (next: string[]) => focusFirst([...next, ...FALLBACK_FOCUS]);

/** Closes something in `close`, then, if focus was inside `el`, moves it to the first of `next` that's on the page. */
export function closeKeepingFocus(el: Element | null, close: () => void, next: string[] = []): void {
    const hadFocus = Boolean(el?.contains(document.activeElement));

    flushSync(close);

    if (hadFocus) focusAfterClose(next);
}

/** Shows `toast` in its slot, replacing the one there. */
export function showToast(toast: Toast): void {
    showNotification({
        slot: toast.slot,
        tone: toast.failed ? 'danger' : 'success',
        dismissLabel: `Dismiss: ${toast.what}`,
        body: toast.body,
        onFocusLost: () => focusAfterClose(toast.focusAfter ?? []),
    });
}

/** Closes whatever toast holds this slot. */
export function clearToast(slot: string): void {
    clearNotification(slot);
}
