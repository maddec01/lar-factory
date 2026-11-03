// Protocol observations supply timing. SQLite supplies residual usage pricing.

import { existsSync } from 'node:fs';
import type { ItemStats } from '@lar-factory/shared';
import { itemStats, transcriptsToRead } from '../stats/item-stats.ts';
import { warmTranscripts } from '../stats/transcript-usage.ts';
import type { ItemStatsReader, StatsSources } from '../stats/item-stats.ts';
import { protocolStatsInputs } from './item-execution.ts';
import { readT3Db } from './t3-db.ts';

/** Item stats from execution observations and usage, as the board shows them. */
export interface T3Reads {
  /** An item's stats over its work record's thread IDs; undefined when it has none, 'unavailable' when they can't be read. */
  stats: (threadIds: readonly string[]) => ItemStats | 'unavailable' | undefined;
  /** True when the database is there but its stats can't be read. */
  statsUnavailable: boolean;
  /** Whether a rate table priced the stats; null when no stats were read. */
  priced: boolean | null;
}

/** An item's stats from `reader`; undefined for an item no thread worked on. */
const statsLookup = (reader: ItemStatsReader): T3Reads['stats'] => (threadIds) => reader(threadIds) ?? undefined;

/** The same answer for every item. */
const every = <T>(value: T) => (): T => value;

/** A failed read: every item with threads can't be read, while an item with none still has no stats to lose. */
const failedRead: T3Reads = { stats: (threadIds) => (threadIds.length ? 'unavailable' : undefined), statsUnavailable: true, priced: null };

/** The stats and their residual usage pricing; item threads read apart, through protocolItemThreads. */
export function loadT3Reads(sources: StatsSources, now: number, withStats = true, threadIds?: readonly string[]): T3Reads {
  if (!withStats) return { stats: every(undefined), statsUnavailable: false, priced: null };
  if (!existsSync(sources.db)) return failedRead;
  try {
    return readT3Db(sources.db, (db) => {
      const { rows, sessions } = protocolStatsInputs(threadIds);
      let stats: ItemStatsReader;
      try { stats = itemStats(db, rows, sources, now, sessions); }
      catch { return failedRead; }
      return { stats: statsLookup(stats), statsUnavailable: false, priced: stats.priced };
    });
  } catch {
    return failedRead;
  }
}

/**
 * Reads the transcripts of T3's threads that the next stats read would read afresh, without blocking, and resolves with
 * how many: the first stats read reads every transcript, seconds of work the board shouldn't stop for. A database that
 * can't be read leaves it to the stats read to say so.
 */
export async function warmT3Stats(sources: StatsSources, threadIds?: readonly string[]): Promise<number> {
  if (!existsSync(sources.db)) return 0;
  let files;
  try {
    files = readT3Db(sources.db, (db) => transcriptsToRead(db, sources, protocolStatsInputs(threadIds).sessions));
  } catch {
    return 0;
  }
  await warmTranscripts(files);
  return files.length;
}
