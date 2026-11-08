// Showing and clearing the toast in each slot, and keeping keyboard focus when a toast or dialog control goes away.

import { clearNotification, showNotification } from '@lar-works/design-system';
import { flushSync } from 'react-dom';

import type { Toast } from './Toasts';
import { OPEN_ITEM_DIALOG } from '@/features/item-dialog';

/** Where focus goes when a closed toast had it and names nowhere of its own. */
const FALLBACK_FOCUS = ['.add-item', '[data-add-item]', '.open-settings', '[data-slot="modal-close"]'];

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
        ...(typeof toast.body === 'string' ? { title: toast.body } : { body: toast.body }),
        onFocusLost: () => focusAfterClose(toast.focusAfter ?? []),
    });
}

/** Closes whatever toast holds this slot. */
export function clearToast(slot: string): void {
    clearNotification(slot);
}
