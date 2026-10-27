// The older comments the item dialog loads under the details' latest 10, one page of 10 per call, from the cursor the
// details gave and then the one each page gave. The pages loaded stay with the details' cache entry, so reopening an
// item whose details are reused shows them again; a page for a list that has gone is dropped.

import { useEffect, useRef, useState } from 'react';
import type { ItemComment, ItemCommentsPage } from '@lar-factory/shared';
import type { DetailsEntry } from './details-cache.ts';

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

async function readPage(itemId: string, before: string, signal: AbortSignal): Promise<ItemCommentsPage | string> {
  try {
    const response = await fetch(`/api/item-comments?itemId=${encodeURIComponent(itemId)}&before=${encodeURIComponent(before)}`, { cache: 'no-store', signal });
    const body = await response.json() as { page?: ItemCommentsPage; error?: string };
    return response.ok && body.page ? body.page : body.error ?? 'The board did not return them.';
  } catch {
    return 'Could not reach the board to read them.';
  }
}

/** The older comments of `itemId`: those `entry` holds, then from the cursor after them, else the details' `olderCursor`. */
export function useOlderComments(itemId: string, entry: DetailsEntry): OlderComments {
  const [state, setState] = useState<{ comments: ItemComment[]; cursor: string | null; loading: boolean; error: string | null }>({
    comments: entry.older?.comments ?? [], cursor: entry.older ? entry.older.cursor : entry.details.olderCursor, loading: false, error: null,
  });
  useEffect(() => { entry.older = { comments: state.comments, cursor: state.cursor }; }, [entry, state.comments, state.cursor]);
  const reading = useRef<AbortController | null>(null);
  useEffect(() => () => reading.current?.abort(), []);
  const loadMore = () => {
    if (!state.cursor || state.loading) return;
    const controller = new AbortController();
    reading.current = controller;
    setState({ ...state, loading: true, error: null });
    void readPage(itemId, state.cursor, controller.signal).then((page) => {
      if (controller.signal.aborted) return;
      setState((now) => typeof page === 'string' ? { ...now, loading: false, error: page } : { comments: [...now.comments, ...page.comments], cursor: page.olderCursor, loading: false, error: null });
    });
  };
  return { comments: state.comments, hasMore: state.cursor !== null, loading: state.loading, error: state.error, loadMore };
}
