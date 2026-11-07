import { useEffect, useRef } from 'react';

/** Focuses a dialog's first editable field when it opens, or once one appears, unless `focusFirstField` is
 *  false, such as while the caller focuses something else; turning it off stops a pending wait. */
export function useModalAutoFocus(focusFirstField = true) {
    const cleanup = useRef<(() => void) | undefined>(undefined);
    const returnFocus = useRef<HTMLElement | null>(null);

    useEffect(() => () => cleanup.current?.(), []);
    useEffect(() => {
        if (!focusFirstField) cleanup.current?.();
    }, [focusFirstField]);

    const onOpenAutoFocus = (event: Event) => {
        cleanup.current?.();

        const dialog = event.target;

        if (!(dialog instanceof HTMLElement)) return;

        returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        if (!focusFirstField) return;

        if (focusFirstEditable(dialog)) {
            event.preventDefault();

            return;
        }

        const observer = new MutationObserver(() => {
            if (focusFirstEditable(dialog)) stop();
        });

        const stop = () => {
            observer.disconnect();
            dialog.removeEventListener('pointerdown', stop, true);
            dialog.removeEventListener('keydown', stop, true);
            cleanup.current = undefined;
        };

        cleanup.current = stop;
        observer.observe(dialog, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                'disabled',
                'readonly',
                'hidden',
                'inert',
                'class',
                'style',
                'aria-disabled',
                'aria-readonly',
                'aria-hidden',
            ],
        });
        dialog.addEventListener('pointerdown', stop, true);
        dialog.addEventListener('keydown', stop, true);
    };

    const onCloseAutoFocus = (event: Event) => {
        cleanup.current?.();

        if (returnFocus.current?.isConnected) {
            event.preventDefault();
            returnFocus.current.focus({ preventScroll: true });
        }
    };

    return { onOpenAutoFocus, onCloseAutoFocus };
}

function focusFirstEditable(dialog: HTMLElement): boolean {
    const candidates = dialog.querySelectorAll<HTMLElement>(
        'input, textarea, select, [role="combobox"], [role="switch"], [role="checkbox"], [role="radio"], [contenteditable="true"], [data-slot="field"] button[aria-haspopup="dialog"]',
    );

    for (const field of candidates) {
        if (
            field.tabIndex < 0 ||
            field.matches(
                ':disabled, [readonly], [aria-disabled="true"], [aria-readonly="true"], input[type="hidden"], input[type="button"], input[type="submit"], input[type="reset"], input[type="image"]',
            ) ||
            field.closest('[hidden], [inert], [aria-hidden="true"], details:not([open])') ||
            field.closest('[role="dialog"]') !== dialog ||
            !isVisible(field, dialog)
        )
            continue;

        field.focus({ preventScroll: true });

        if (document.activeElement !== field) continue;

        if (
            field instanceof HTMLTextAreaElement ||
            (field instanceof HTMLInputElement && field.selectionStart !== null)
        ) {
            field.select();
        }

        return true;
    }

    return false;
}

function isVisible(field: HTMLElement, dialog: HTMLElement): boolean {
    if (getComputedStyle(field).visibility !== 'visible') return false;

    for (let element: HTMLElement | null = field; element; element = element.parentElement) {
        if (getComputedStyle(element).display === 'none') return false;

        if (element === dialog) return true;
    }

    return false;
}
