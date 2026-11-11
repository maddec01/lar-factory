// The board's life (items.css's board-life sheet): when a board read moves an item to another lane, its row slides in
// and flashes a navy wash; when one lands on Your desk, its card pulses its amber edge once. Only a read that changes
// where an item is does it: the first paint, a scope or a filter never do, and an unsettled first read only sets where
// things start. Feature code notes where every item is after each read (noteBoardPlaces), from the whole board, never
// the filtered view; the rows and cards ask whether they just arrived (useArrival).

import { useSyncExternalStore } from 'react';

/** What the board tracks: the stage lanes, each item's place its lane, and the desk, where an item is or isn't. */
export type BoardLifeScope = 'lane' | 'desk';

/** How long an arrival stays news: past the flash, so a row that renders again mid-flash keeps it. */
const NEWS_MS = 1_600;

/** An item's arrival: when it landed, and for a lane change the lanes' order before and after it (which side it came
 *  from). */
export interface Arrival {
    at: number;
    /** The item came from a lane earlier on the board (`above`) or a later one (`below`); none for the desk. */
    from?: 'above' | 'below' | undefined;
}

interface ScopeState {
    /** The places of the last read, by item id: a lane's place in the board's order, or 0 on the desk. */
    places: Map<string, number> | undefined;
    signature: string | undefined;
    arrivals: Map<string, Arrival>;
}

const scopes: Record<BoardLifeScope, ScopeState> = {
    lane: { places: undefined, signature: undefined, arrivals: new Map() },
    desk: { places: undefined, signature: undefined, arrivals: new Map() },
};

/** The time of the last arrival, which the rows and cards subscribe to. */
let version = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/**
 * Notes where every item is after a read: `places` maps an item's id to its lane's place in the board's order (or to 0
 * for the desk). An item whose place changed (a lane), or that is new to it (the desk), arrives, unless the read is the
 * first or `settled` is false (a first read still landing). Called while rendering, it does nothing for places it has
 * already seen, so a render that repeats changes nothing.
 */
export function noteBoardPlaces(scope: BoardLifeScope, places: Map<string, number>, settled: boolean) {
    const state = scopes[scope];
    const signature = [...places].map(([id, place]) => `${id}:${place}`).join('|');

    if (signature === state.signature) return;

    const now = Date.now();
    let arrived = false;

    if (state.places && settled)
        for (const [id, place] of places) {
            const before = state.places.get(id);
            const moved = scope === 'desk' ? before === undefined : before !== undefined && before !== place;

            if (!moved) continue;

            state.arrivals.set(id, {
                at: now,
                from: before === undefined ? undefined : before < place ? 'above' : 'below',
            });
            arrived = true;
        }

    for (const [id, arrival] of state.arrivals) if (now - arrival.at > NEWS_MS) state.arrivals.delete(id);

    state.places = places;
    state.signature = signature;

    if (arrived) {
        version = now;
        // The rows that just arrived render with this read; the others learn of it after it commits.
        queueMicrotask(notify);
        // Once it's no longer news, the arrival goes, so a row that mounts again later (a filter, a scope) is still.
        setTimeout(() => {
            if (state.arrivals.size === 0) return;

            for (const [id, arrival] of state.arrivals)
                if (Date.now() - arrival.at >= NEWS_MS) state.arrivals.delete(id);
            version = Date.now();
            notify();
        }, NEWS_MS);
    }
}

const subscribe = (listener: () => void) => {
    listeners.add(listener);

    return () => listeners.delete(listener);
};

/** Whether `item` just arrived in `scope` (its arrival, while it is news), for its row or card to show it once. */
export function useArrival(scope: BoardLifeScope, item: string): Arrival | undefined {
    useSyncExternalStore(
        subscribe,
        () => version,
        () => 0,
    );

    return scopes[scope].arrivals.get(item);
}
