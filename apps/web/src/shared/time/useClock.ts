// The board's one timer for values that change with the time alone, such as an age or an activity read going old. It
// wakes only when a reader's answer may change, so a board with nothing live on screen runs no timer.

import { useState, useSyncExternalStore } from 'react';

const readers = new Set<Reader>();
let timer: ReturnType<typeof setTimeout> | undefined;
let timerDue = Infinity;

/** Sets the one timer for the earliest reader due, or none while the window is hidden or no reader is. */
function schedule() {
    clearTimeout(timer);
    timer = undefined;
    timerDue = Infinity;

    if (document.hidden) return;

    for (const reader of readers) if (reader.due !== undefined && reader.due < timerDue) timerDue = reader.due;

    if (timerDue === Infinity) return;

    timer = setTimeout(tick, Math.max(0, timerDue - Date.now()));
}

function tick() {
    const now = Date.now();

    // Telling React makes it read again, which sets each reader's next due time.
    for (const reader of readers)
        if (reader.due !== undefined && reader.due <= now) {
            reader.due = undefined;
            reader.notify();
        }

    schedule();
}

function onVisibility() {
    // A hidden window skipped its ticks, so everything due reads again.
    if (!document.hidden) tick();
    else schedule();
}

/** A mounted reader: when its answer may next change, if ever, and how to tell React to read it again. */
class Reader {
    due: number | undefined;
    notify = () => {};

    /** Sets its answer's next change `wait` from `now`, or none, bringing the timer forward when that falls before it. */
    follow(now: number, wait: number | undefined) {
        this.due = wait === undefined ? undefined : now + wait;
        this.bringForward();
    }

    /** Brings the timer forward to this reader's due time, when it falls before it. */
    private bringForward() {
        if (readers.has(this) && this.due !== undefined && this.due < timerDue && !document.hidden) schedule();
    }

    subscribe = (notify: () => void) => {
        this.notify = notify;
        readers.add(this);

        if (readers.size === 1) document.addEventListener('visibilitychange', onVisibility);

        this.bringForward();

        return () => {
            readers.delete(this);

            if (!readers.size) document.removeEventListener('visibilitychange', onVisibility);

            if (this.due === timerDue) schedule();
        };
    };
}

/**
 * What `read` says at the time, rendering its caller only when that changes. `next` says how long from `now` until the
 * answer may change, or undefined when the time can't change it, so a reader with nothing live keeps no timer.
 */
export function useClock<T>(read: (now: number) => T, next: (now: number) => number | undefined = () => 1_000): T {
    const [reader] = useState(() => new Reader());

    return useSyncExternalStore(reader.subscribe, () => {
        const now = Date.now();

        reader.follow(now, next(now));

        return read(now);
    });
}
