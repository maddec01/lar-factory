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

/** The stats and their residual usage pricing; item threads read apart, through protocolItemThreads. */
export function loadT3Reads(sources: StatsSources, now: number, withStats = true): T3Reads {
  if (!withStats) return { stats: every(undefined), statsUnavailable: false, priced: null };
  if (!existsSync(sources.db)) return { stats: every('unavailable'), statsUnavailable: true, priced: null };
  const unavailable = { stats: every('unavailable' as const), statsUnavailable: true, priced: null };
  try {
    return readT3Db(sources.db, (db) => {
      const { rows, sessions } = protocolStatsInputs();
      let stats: ItemStatsReader;
      try { stats = itemStats(db, rows, sources, now, sessions); }
      catch { return unavailable; }
      return { stats: statsLookup(stats), statsUnavailable: false, priced: stats.priced };
    });
  } catch {
    return unavailable;
  }
}

/**
 * Reads the transcripts of T3's threads that the next stats read would read afresh, without blocking, and resolves with
 * how many: the first stats read reads every transcript, seconds of work the board shouldn't stop for. A database that
 * can't be read leaves it to the stats read to say so.
 */
export async function warmT3Stats(sources: StatsSources): Promise<number> {
  if (!existsSync(sources.db)) return 0;
  let files;
  try {
    files = readT3Db(sources.db, (db) => transcriptsToRead(db, sources, protocolStatsInputs().sessions));
  } catch {
    return 0;
  }
  await warmTranscripts(files);
  return files.length;
}
