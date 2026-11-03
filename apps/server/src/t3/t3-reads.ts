// Protocol observations supply timing. SQLite supplies residual usage pricing.

import { existsSync } from 'node:fs';
import type { Item, ItemStats } from '@lar-factory/shared';
import { AGGREGATION_WORK_PER_CHUNK, ITEM_WORK, itemStats, threadsKey } from '../stats/item-stats.ts';
import type { ItemStatsReader, StatsSources } from '../stats/item-stats.ts';
import { loopTrace } from '../startup/loop-trace.ts';
import { createReadTrace } from '../stats/read-trace.ts';
import type { ReadTrace } from '../stats/read-trace.ts';
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

/** One answer for every item with threads, while an item with none has no stats to lose. */
const withThreads = (usage: NonNullable<Item['usageState']>): T3Reads['usage'] => (threadIds) => (threadIds.length ? usage : 'current');

/** A failed read: every item with threads can't be read, while an item with none still has no stats to lose. */
const failedRead: T3Reads = { stats: (threadIds) => (threadIds.length ? 'unavailable' : undefined), usage: withThreads('failed'), statsUnavailable: true, priced: null, allObserved: false };

/** T3 runs with its thread list not read yet: nothing has failed, and no stats were read. */
const loadingRead: T3Reads = { stats: () => undefined, usage: withThreads('loading'), statsUnavailable: false, priced: null, allObserved: false };

/** What a stats read reports beyond the board's figures. */
export type StatsRead = T3Reads & {
  /** How many transcripts it counted, and how many of those it parsed, as they weren't cached or changed since. */
  transcripts: number;
  parsed: number;
};

const nothingRead = (reads: T3Reads): StatsRead => ({ ...reads, transcripts: 0, parsed: 0 });

/** Whose stats a read works out, and at what time. */
export interface StatsReadOptions {
  now: number;
  /** The threads of the items on the board. Undefined reads all of T3's. */
  threadIds?: readonly string[];
  /** Each item's thread IDs, whose answers the read works out in chunks. */
  items?: readonly (readonly string[])[];
  trace?: ReadTrace;
}

/**
 * The one stats read: T3's threads as they stand when it starts, and each transcript's records as they stand when it
 * reaches them, none read synchronously, with every answer from that one pass. So a thread or transcript that changes
 * while it yields waits for the next read. It reports a database that can't be read, and leaves thread lists unread as loading.
 */
export async function readT3Stats(sources: StatsSources, { now, threadIds, items = [], trace = createReadTrace() }: StatsReadOptions): Promise<StatsRead> {
  if (!existsSync(sources.db)) return nothingRead(failedRead);
  try {
    loopTrace.span('t3 db check', () => readT3Db(sources.db, () => {}));
    trace.step('inputs');
    const inputs = await protocolStatsInputs(threadIds, trace.pause);
    if (!inputs) return nothingRead(loadingRead);
    let stats: ItemStatsReader;
    try { stats = await itemStats(sources, inputs.rows, now, { sessions: inputs.sessions, items, trace }); }
    catch { return nothingRead(failedRead); }
    const states = new Map<string, NonNullable<Item['usageState']>>();
    const usage: T3Reads['usage'] = (ids) => {
      const key = threadsKey(ids);
      let state = states.get(key);
      if (!state) {
        const reads = inputs.familyReads(ids);
        state = reads.includes('failed') ? 'failed' : reads.includes('never') ? 'loading' : 'current';
        states.set(key, state);
      }
      return state;
    };
    let counted = 0;
    for (const ids of items) {
      usage(ids);
      if (++counted * ITEM_WORK >= AGGREGATION_WORK_PER_CHUNK) {
        counted = 0;
        await trace.pause();
      }
    }
    return {
      stats: (ids) => {
        const state = usage(ids);
        return state === 'failed' ? 'unavailable' : state === 'loading' ? undefined : stats(ids) ?? undefined;
      },
      usage, statsUnavailable: false, priced: stats.priced, allObserved: inputs.allObserved, transcripts: stats.transcripts, parsed: stats.parsed,
    };
  } catch {
    return nothingRead(failedRead);
  }
}
