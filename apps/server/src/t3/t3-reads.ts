// Protocol observations supply timing. SQLite supplies residual usage pricing.

import { existsSync } from 'node:fs';
import type { Item, ItemStats } from '@lar-factory/shared';
import { itemStats, transcriptsToRead } from '../stats/item-stats.ts';
import { warmTranscripts } from '../stats/transcript-usage.ts';
import type { ItemStatsReader, StatsSources } from '../stats/item-stats.ts';
import { protocolStatsInputs } from './item-execution.ts';
import { readT3Db } from './t3-db.ts';

/** Item stats from execution observations and usage, as the board shows them. */
export interface T3Reads {
  /** An item's stats over its work record's thread IDs; undefined when it has none or its family is still loading, 'unavailable' when it can't be read. */
  stats: (threadIds: readonly string[]) => ItemStats | 'unavailable' | undefined;
  /** How far this read answers for an item's thread family; an item with no threads has nothing to wait for. */
  usage: (threadIds: readonly string[]) => NonNullable<Item['usageState']>;
  /** True when the database is there but its stats can't be read. */
  statsUnavailable: boolean;
  /** Whether a rate table priced the stats; null when no stats were read. */
  priced: boolean | null;
  /** Whether every thread of the read was observed at least once. Until then a record can sit on the wrong item, so figures are provisional. */
  allObserved: boolean;
}

/** The same answer for every item. */
const every = <T>(value: T) => (): T => value;

/** One answer for every item with threads, while an item with none has no stats to lose. */
const withThreads = (usage: NonNullable<Item['usageState']>): T3Reads['usage'] => (threadIds) => (threadIds.length ? usage : 'current');

/** A failed read: every item with threads can't be read, while an item with none still has no stats to lose. */
const failedRead: T3Reads = { stats: (threadIds) => (threadIds.length ? 'unavailable' : undefined), usage: withThreads('failed'), statsUnavailable: true, priced: null, allObserved: false };

/** T3 runs with its thread list not read yet: nothing has failed, and no stats were read. */
const loadingRead: T3Reads = { stats: every(undefined), usage: withThreads('loading'), statsUnavailable: false, priced: null, allObserved: false };

/** The stats and their residual usage pricing; item threads read apart, through protocolItemThreads. */
export function loadT3Reads(sources: StatsSources, now: number, withStats = true, threadIds?: readonly string[]): T3Reads {
  if (!withStats) return { stats: every(undefined), usage: every('current'), statsUnavailable: false, priced: null, allObserved: false };
  if (!existsSync(sources.db)) return failedRead;
  try {
    return readT3Db(sources.db, (db) => {
      const inputs = protocolStatsInputs(threadIds);
      if (!inputs) return loadingRead;
      let stats: ItemStatsReader;
      try { stats = itemStats(db, inputs.rows, sources, now, inputs.sessions); }
      catch { return failedRead; }
      const usage: T3Reads['usage'] = (ids) => {
        const reads = inputs.familyReads(ids);
        return reads.includes('failed') ? 'failed' : reads.includes('never') ? 'loading' : 'current';
      };
      return {
        stats: (ids) => {
          const state = usage(ids);
          return state === 'failed' ? 'unavailable' : state === 'loading' ? undefined : stats(ids) ?? undefined;
        },
        usage, statsUnavailable: false, priced: stats.priced, allObserved: inputs.allObserved,
      };
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
    files = readT3Db(sources.db, (db) => transcriptsToRead(db, sources, protocolStatsInputs(threadIds)?.sessions ?? []));
  } catch {
    return 0;
  }
  await warmTranscripts(files);
  return files.length;
}
