// The board's one timer for values that change with the time alone, such as an age or an activity read going old.

import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function tick() {
    for (const each of listeners) each();
}

function followVisibility() {
    clearInterval(timer);
    timer = undefined;

    if (document.hidden) return;

    tick();
    timer = setInterval(tick, 1_000);
}

/** One timer for the board, running while anything follows it and the window is visible. */
function onSecond(listener: () => void) {
    listeners.add(listener);

    if (listeners.size === 1) {
        document.addEventListener('visibilitychange', followVisibility);
        followVisibility();
    }

    return () => {
        listeners.delete(listener);

        if (listeners.size) return;

        clearInterval(timer);
        timer = undefined;
        document.removeEventListener('visibilitychange', followVisibility);
    };
}

/** What `read` says at the time, rendering its caller only when that changes. */
export const useClock = <T>(read: (now: number) => T): T => useSyncExternalStore(onSecond, () => read(Date.now()));
