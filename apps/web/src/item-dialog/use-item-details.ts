// Reads an item's details from the board when the item dialog opens on it, once per open. Closing keeps what the
// dialog still shows while it animates away; the next open reads again. A reply for a dialog that has since closed
// or moved to another item is ignored.

import { useLayoutEffect, useState } from 'react';
import type { ItemDetails } from '@lar-factory/shared';

export type ItemDetailsRead = { state: 'loading' } | { state: 'loaded'; details: ItemDetails } | { state: 'failed'; error: string };

const LOADING: ItemDetailsRead = { state: 'loading' };

async function readDetails(itemId: string, signal: AbortSignal): Promise<ItemDetailsRead> {
  try {
    const response = await fetch(`/api/item-details?itemId=${encodeURIComponent(itemId)}`, { cache: 'no-store', signal });
    const body = await response.json() as { details?: ItemDetails; error?: string };
    if (response.ok && body.details) return { state: 'loaded', details: body.details };
    return { state: 'failed', error: body.error ?? 'The board did not return the details.' };
  } catch {
    return { state: 'failed', error: 'Could not reach the board to read the details.' };
  }
}

/** The details of the item the dialog shows, loading until they arrive; `open` is false while the dialog animates closed. */
export function useItemDetails(itemId: string | undefined, open: boolean): ItemDetailsRead {
  const [read, setRead] = useState<{ itemId: string; result: ItemDetailsRead } | null>(null);
  // A layout effect starts the read before paint, so a reopened item never flashes its earlier details.
  useLayoutEffect(() => {
    if (!itemId || !open) return;
    const reading = new AbortController();
    setRead({ itemId, result: LOADING });
    void readDetails(itemId, reading.signal).then((result) => !reading.signal.aborted && setRead({ itemId, result }));
    return () => reading.abort();
  }, [itemId, open]);
  return read && read.itemId === itemId ? read.result : LOADING;
}
