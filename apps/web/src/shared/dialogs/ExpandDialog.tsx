// The expand control a dialog's header shows: the button, or ⌘⇧E (Ctrl+Shift+E off a Mac), grows the dialog to the
// window less a small margin and back, even while focus is in a field. The design system's Modal.Content draws the
// expanded size (its `expanded`) and ModalExpandButton the control; this holds the shortcut and the preferences.

import { ModalExpandButton } from '@lar-works/design-system';
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

const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

const SHORTCUT = MAC ? { label: '⌘⇧E', keys: 'Meta+Shift+E' } : { label: 'Ctrl+Shift+E', keys: 'Control+Shift+E' };

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

export function ExpandButton({ expanded, toggle }: { expanded: boolean; toggle: () => void }) {
    return <ModalExpandButton expanded={expanded} onToggle={toggle} shortcut={SHORTCUT} />;
}
