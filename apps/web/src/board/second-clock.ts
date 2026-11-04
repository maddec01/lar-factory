// The board's one timer for values that change with the time alone, such as an age or an activity read going old.

import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

/** One timer for the board, running while anything follows it. */
function onSecond(listener: () => void) {
  listeners.add(listener);
  timer ??= setInterval(() => { for (const each of listeners) each(); }, 1_000);
  return () => {
    listeners.delete(listener);
    if (listeners.size) return;
    clearInterval(timer);
    timer = undefined;
  };
}

/** What `read` says at the time, rendering its caller only when that changes. */
export const useClock = <T,>(read: (now: number) => T): T => useSyncExternalStore(onSecond, () => read(Date.now()));
