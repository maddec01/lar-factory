// The details the item dialog last fetched for each item, reused on reopen while the board's updatedAt for the item is
// still the one they were read at. Checked on 2026-10-27: a new comment advances updatedAt on both providers, so both
// cache. GitHub: in lar-server#203 the issue's updatedAt equals its last comment's createdAt, and no issue or pull
// request of lar-factory or lar-server has an updatedAt before its last comment. Azure DevOps: a comment is a
// revision of the work item (its text goes to System.History), and a revision sets System.ChangedDate.

import type { ItemComment, ItemDetails } from '@lar-factory/shared';

/** The older comments "Load 10 more" fetched, with the cursor of the next page. */
interface OlderPages {
  comments: ItemComment[];
  cursor: string | null;
}

export interface DetailsEntry {
  /** The item's updatedAt on the board when the details were read. */
  updatedAt: string;
  details: ItemDetails;
  /** What "Load 10 more" added since; kept with the entry so a reopen shows it. */
  older: OlderPages | null;
}

/** Entries kept at once; the least recently used goes first. */
const BOUND = 20;

/** `cached` says whether an item's provider advances updatedAt on a new comment; both do, so by default every item is kept. */
export function createDetailsCache(cached: (itemId: string) => boolean = () => true, bound = BOUND) {
  const entries = new Map<string, DetailsEntry>();
  return {
    /** The entry read at `updatedAt`, or null when there is none or the item has changed since. */
    get(itemId: string, updatedAt: string): DetailsEntry | null {
      const entry = entries.get(itemId);
      if (!entry || entry.updatedAt !== updatedAt) return null;
      entries.delete(itemId);
      entries.set(itemId, entry);
      return entry;
    },
    put(itemId: string, entry: DetailsEntry): void {
      if (!cached(itemId)) return;
      entries.delete(itemId);
      entries.set(itemId, entry);
      if (entries.size > bound) entries.delete(entries.keys().next().value!);
    },
  };
}

export const detailsCache = createDetailsCache();
