// What the board reads from T3 Code's database on each refresh: every item's stats
// and T3 threads, from one open of the database (docs/adr/0005).

import { existsSync } from 'node:fs';
import type { Item, ItemStats, ItemThread } from '@mux-factory/shared';
import { itemStats } from '../stats/item-stats.ts';
import type { ItemStatsReader, StatsSources } from '../stats/item-stats.ts';
import { itemThreads } from '../threads/item-threads.ts';
import type { ItemThreadsReader } from '../threads/item-threads.ts';
import { readT3Db, threadRows } from './t3-db.ts';

type Issue = Pick<Item, 'repo' | 'number'>;

/** One read of T3's database, as the board shows it. */
export interface T3Reads {
  /** An item's stats; undefined when it has none, 'unavailable' when they can't be read. */
  stats: (item: Issue) => ItemStats | 'unavailable' | undefined;
  /** An item's threads, newest first; undefined when it has none, 'unavailable' when they can't be read. */
  threads: (item: Issue) => ItemThread[] | 'unavailable' | undefined;
  /** True when the database is there but its stats can't be read. */
  statsUnavailable: boolean;
  /** Whether a rate table priced the stats; null when no stats were read. */
  priced: boolean | null;
}

/** An item's stats from `reader`; undefined for a draft, or an item no thread worked on. */
const statsLookup = (reader: ItemStatsReader): T3Reads['stats'] => ({ repo, number }) =>
  (repo && number !== null ? reader(repo, number) : null) ?? undefined;

/** An item's threads from `reader`; undefined for a draft, or an item no thread names. */
const threadsLookup = (reader: ItemThreadsReader): T3Reads['threads'] => ({ repo, number }) => {
  const own = repo && number !== null ? reader(repo, number) : [];
  return own.length ? own : undefined;
};

/** The same answer for every item. */
const every = <T>(value: T) => (): T => value;

/**
 * Opens T3's database once for the item stats and the item threads, which read the same thread rows. Stats read
 * more than the rows, so they can be unavailable while the threads are read, e.g. after T3 changes its schema.
 */
export function loadT3Reads(sources: StatsSources, now: number): T3Reads {
  if (!existsSync(sources.db)) return { stats: every(undefined), threads: every(undefined), statsUnavailable: false, priced: null };
  const unavailable = { stats: every('unavailable' as const), statsUnavailable: true, priced: null };
  try {
    return readT3Db(sources.db, (db) => {
      const rows = threadRows(db);
      const threads = threadsLookup(itemThreads(rows));
      let stats: ItemStatsReader;
      try { stats = itemStats(db, rows, sources, now); }
      catch { return { ...unavailable, threads }; }
      return { stats: statsLookup(stats), threads, statsUnavailable: false, priced: stats.priced };
    });
  } catch {
    return { ...unavailable, threads: every('unavailable' as const) };
  }
}
