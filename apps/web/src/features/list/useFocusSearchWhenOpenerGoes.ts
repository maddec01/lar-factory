import { useEffect, useRef } from 'react';

import { useItemDialogStore } from '@/features/item-dialog';

/**
 * When the item dialog closes and the design system's Modal had nowhere to return focus, as when its item left List while it
 * was open and took its row along, focus goes to the List's search field.
 */
export function useFocusSearchWhenOpenerGoes(searchField: React.RefObject<HTMLInputElement | null>) {
    const itemOpen = useItemDialogStore((state) => state.itemId !== null);
    const wasOpen = useRef(false);

    useEffect(() => {
        const closed = wasOpen.current && !itemOpen;

        wasOpen.current = itemOpen;

        if (!closed) return;

        // The design system's Modal returns focus on the next task when the element that had it is still on the page.
        const timer = setTimeout(() => {
            if (
                document.activeElement === document.body ||
                document.activeElement === searchField.current?.closest('[data-list-modal]')
            )
                searchField.current?.focus({ preventScroll: true });
        });

        return () => clearTimeout(timer);
    }, [itemOpen, searchField]);
}
