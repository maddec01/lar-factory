// An item's details as the item dialog reads them, and the older comments it loads under them.
//
// The details are read when the dialog opens on an item, once per open. The next open reuses the details cached for the
// item's updatedAt, else reads again. A reply for a dialog that has since closed or moved to another item is ignored.
// `refresh` reads them again while the dialog stays open, showing the new ones without a loading state; a failed read
// keeps the ones on show. Refreshes never overlap: one asked for while another reads starts once that one ends, and any
// more asked for meanwhile share it, so each caller still gets a read that began after it asked.
//
// The older comments come one page of 10 per call, from the cursor the details gave and then the one each page gave.
// The pages loaded stay with the details' cache entry, so reopening an item whose details are reused shows them again; a
// page for a list that has gone is dropped.

import type { ItemComment } from '@lar-factory/shared';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { detailsCache, keepOlder, type DetailsEntry } from './details-cache';
import { readItemDetails, readOlderComments } from './items.service';

export type ItemDetailsRead =
    | { state: 'loading' }
    | { state: 'loaded'; details: DetailsEntry['details']; entry: DetailsEntry }
    | { state: 'failed'; error: string };

export type { DetailsEntry };

const LOADING: ItemDetailsRead = { state: 'loading' };

async function readDetails(itemId: string, updatedAt: string, signal: AbortSignal): Promise<ItemDetailsRead> {
    const answer = await readItemDetails(itemId, signal);

    if ('error' in answer) return { state: 'failed', error: answer.error };

    const entry: DetailsEntry = { updatedAt, details: answer.details, older: null };

    detailsCache.put(itemId, entry);

    return { state: 'loaded', details: answer.details, entry };
}

/**
 * The details of the item the dialog shows, loading until they arrive.
 * The cache is keyed by the `updatedAt` the item has when the dialog opens, which later board updates don't move.
 * `refresh` reads them again, keeping the ones on show until the new ones arrive, or for good when the read fails; it
 * says whether the read worked.
 */
export function useItemDetails(
    itemId: string,
    updatedAt: string,
): { read: ItemDetailsRead; refresh: () => Promise<boolean> } {
    const board = useRef(updatedAt);

    useLayoutEffect(() => {
        board.current = updatedAt;
    });

    const [read, setRead] = useState<{ itemId: string; result: ItemDetailsRead } | null>(null);
    /** The refresh still reading, and the one that follows it, which the refreshes asked for meanwhile share. */
    const refreshing = useRef<{ itemId: string; done: Promise<boolean>; next?: Promise<boolean> } | null>(null);

    // A layout effect starts the read before paint, so a reopened item never flashes its earlier details.
    useLayoutEffect(() => {
        const cached = detailsCache.get(itemId, board.current);

        if (cached) {
            setRead({ itemId, result: { state: 'loaded', details: cached.details, entry: cached } });

            return;
        }

        const reading = new AbortController();

        setRead({ itemId, result: LOADING });
        void readDetails(itemId, board.current, reading.signal).then(
            (result) => !reading.signal.aborted && setRead({ itemId, result }),
        );

        return () => reading.abort();
    }, [itemId]);

    const refresh = useCallback(() => {
        const start = (): Promise<boolean> => {
            const done = readDetails(itemId, board.current, new AbortController().signal).then((result) => {
                setRead((shown) =>
                    shown?.itemId === itemId && (result.state === 'loaded' || shown.result.state !== 'loaded')
                        ? { itemId, result }
                        : shown,
                );

                return result.state === 'loaded';
            });
            const current: { itemId: string; done: Promise<boolean>; next?: Promise<boolean> } = { itemId, done };

            refreshing.current = current;
            void done.finally(() => {
                if (refreshing.current === current) refreshing.current = null;
            });

            return done;
        };
        const reading = refreshing.current;

        if (reading?.itemId !== itemId) return start();

        reading.next ??= reading.done.then(start);

        return reading.next;
    }, [itemId]);

    return { read: read && read.itemId === itemId ? read.result : LOADING, refresh };
}

/** Forgets the item's cached details, as a write has made them stale, so the next open or refresh reads them again. */
export const forgetItemDetails = (itemId: string): void => detailsCache.drop(itemId);

export interface OlderComments {
    /** The pages loaded so far, in the details' order: each page's comments follow the one before. */
    comments: ItemComment[];
    /** Whether a "Load 10 more" has older comments to fetch. */
    hasMore: boolean;
    loading: boolean;
    /** Why the last load failed; the comments already loaded stay. */
    error: string | null;
    loadMore: () => void;
}

/** The older comments of `itemId`: those `entry` holds, then from the cursor after them, else the details' `olderCursor`. */
export function useOlderComments(itemId: string, entry: DetailsEntry): OlderComments {
    const [state, setState] = useState<{
        comments: ItemComment[];
        cursor: string | null;
        loading: boolean;
        error: string | null;
    }>({
        comments: entry.older?.comments ?? [],
        cursor: entry.older ? entry.older.cursor : entry.details.olderCursor,
        loading: false,
        error: null,
    });

    useEffect(() => {
        keepOlder(entry, { comments: state.comments, cursor: state.cursor });
    }, [entry, state.comments, state.cursor]);

    const reading = useRef<AbortController | null>(null);

    useEffect(() => () => reading.current?.abort(), []);

    const loadMore = () => {
        if (!state.cursor || state.loading) return;

        const controller = new AbortController();

        reading.current = controller;
        setState({ ...state, loading: true, error: null });
        void readOlderComments(itemId, state.cursor, controller.signal).then((page) => {
            if (controller.signal.aborted) return;

            setState((now) =>
                typeof page === 'string'
                    ? { ...now, loading: false, error: page }
                    : {
                          comments: [...now.comments, ...page.comments],
                          cursor: page.olderCursor,
                          loading: false,
                          error: null,
                      },
            );
        });
    };

    return {
        comments: state.comments,
        hasMore: state.cursor !== null,
        loading: state.loading,
        error: state.error,
        loadMore,
    };
}
