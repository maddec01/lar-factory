// Whether the window is at least 40rem wide, where the title bar's status group stays open; under it the bar keeps to
// need you, beside its actions.

import { useSyncExternalStore } from 'react';

const QUERY = '(min-width: 40rem)';

const subscribe = (change: () => void) => {
    const list = matchMedia(QUERY);

    list.addEventListener('change', change);

    return () => list.removeEventListener('change', change);
};

export const useWideBar = (): boolean =>
    useSyncExternalStore(
        subscribe,
        () => matchMedia(QUERY).matches,
        () => true,
    );
