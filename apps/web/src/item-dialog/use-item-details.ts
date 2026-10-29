// Reads an item's details from the board when the item dialog opens on it, once per open. The next open reuses the
// details cached for the item's updatedAt, else reads again. A reply for a dialog that has since closed or moved to another item is ignored.
// A saved description reads them again while the dialog stays open, showing the new ones without a loading state; a
// failed read again keeps the ones on show.

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ItemDetails } from '@lar-factory/shared';
import { detailsCache, type DetailsEntry } from './details-cache.ts';

export type ItemDetailsRead = { state: 'loading' } | { state: 'loaded'; details: ItemDetails; entry: DetailsEntry } | { state: 'failed'; error: string };

const LOADING: ItemDetailsRead = { state: 'loading' };

async function readDetails(itemId: string, updatedAt: string, signal: AbortSignal): Promise<ItemDetailsRead> {
  try {
    const response = await fetch(`/api/item-details?itemId=${encodeURIComponent(itemId)}`, { cache: 'no-store', signal });
    const body = await response.json() as { details?: ItemDetails; error?: string };
    if (response.ok && body.details) {
      const entry: DetailsEntry = { updatedAt, details: body.details, older: null };
      detailsCache.put(itemId, entry);
      return { state: 'loaded', details: body.details, entry };
    }
    return { state: 'failed', error: body.error ?? 'The board did not return the details.' };
  } catch {
    return { state: 'failed', error: 'Could not reach the board to read the details.' };
  }
}

/**
 * The details of the item the dialog shows, loading until they arrive.
 * The cache is keyed by the `updatedAt` the item has when the dialog opens, which later board updates don't move.
 * `refresh` reads them again, keeping the ones on show until the new ones arrive, or for good when the read fails; it
 * says whether the read worked.
 */
export function useItemDetails(itemId: string, updatedAt: string): { read: ItemDetailsRead; refresh: () => Promise<boolean> } {
  const board = useRef(updatedAt);
  board.current = updatedAt;
  const [read, setRead] = useState<{ itemId: string; result: ItemDetailsRead } | null>(null);
  // A layout effect starts the read before paint, so a reopened item never flashes its earlier details.
  useLayoutEffect(() => {
    const cached = detailsCache.get(itemId, board.current);
    if (cached) {
      setRead({ itemId, result: { state: 'loaded', details: cached.details, entry: cached } });
      return;
    }
    const reading = new AbortController();
    setRead({ itemId, result: LOADING });
    void readDetails(itemId, board.current, reading.signal).then((result) => !reading.signal.aborted && setRead({ itemId, result }));
    return () => reading.abort();
  }, [itemId]);
  const refresh = useCallback(async () => {
    const result = await readDetails(itemId, board.current, new AbortController().signal);
    if (result.state !== 'loaded') return false;
    setRead((shown) => (shown?.itemId === itemId ? { itemId, result } : shown));
    return true;
  }, [itemId]);
  return { read: read && read.itemId === itemId ? read.result : LOADING, refresh };
}
