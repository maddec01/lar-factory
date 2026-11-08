// A dialog's expanded size and keyboard shortcut, with this browser's opening-size preferences. Child dialogs can
// follow the open List modal's size.

import { useEffect, useState } from 'react';

export const DIALOG_PREFERENCES = {
    matchList: 'lar-board:match-list-size',
    openList: 'lar-board:open-list-expanded',
} as const;

export function dialogPreference(key: keyof typeof DIALOG_PREFERENCES): boolean {
    return localStorage.getItem(DIALOG_PREFERENCES[key]) === '1';
}

function childOpeningSize(): boolean {
    return (
        dialogPreference('matchList') &&
        document.querySelector('[data-list-modal]')?.getAttribute('data-expanded') === 'true'
    );
}

export const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** Whether the dialog is expanded, and a toggle; the shortcut toggles it too, unless `paused` while a prompt sits on top. */
export function useExpand(paused = false, initial = childOpeningSize()): readonly [boolean, () => void] {
    const [expanded, setExpanded] = useState(initial);

    useEffect(() => {
        if (paused) return;

        const onKey = (event: KeyboardEvent) => {
            if (
                event.key.toLowerCase() !== 'e' ||
                !event.shiftKey ||
                event.altKey ||
                !(MAC ? event.metaKey : event.ctrlKey)
            )
                return;

            event.preventDefault();
            setExpanded((on) => !on);
        };

        // Captured, so a field that handles its own keys, such as the description editor, still lets it through.
        addEventListener('keydown', onKey, true);

        return () => removeEventListener('keydown', onKey, true);
    }, [paused]);

    return [expanded, () => setExpanded((on) => !on)] as const;
}
