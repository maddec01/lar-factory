// Brings the items' usage up to date as thread reads land, from the first read on and again whenever threads join. A
// transcript's records come from a session a thread read names, so each stats read here follows a warm of what the reads
// so far name, and parsing never holds up the board's thread.

import { performance } from 'node:perf_hooks';
import type { StatsSources } from '../stats/item-stats.ts';
import { protocolThreadReads } from './item-execution.ts';
import type { ThreadReads } from './item-execution.ts';
import { warmT3Stats } from './t3-reads.ts';
import type { T3Reads } from './t3-reads.ts';

export interface UsageCatchUpOptions {
  sources: StatsSources;
  /** The threads of the items on the board now. */
  threadIds: () => string[];
  /** Whether the first read has settled. */
  settled: () => boolean;
  /** How long since the last stats read, of any path, in milliseconds. */
  sinceStatsRead: () => number;
  /** How long a stats read here waits after the last one. */
  paceMs: () => number;
  /** How long a caught-up board looks for nothing here, so an idle board spends nothing. A stats read's `active` check ends it early. */
  quietMs: number;
  /** Shows a stats read on the board's items. */
  publish: (reads: T3Reads) => void;
  /** Runs once, when all observed usage has arrived for every item of the settled first read. */
  caughtUp: () => void;
  /** Logs a step with its time. */
  timed: (step: string) => void;
}

export interface UsageCatchUp {
  /** Asks for the reads still needed and, when reads have landed and the pace allows, warms and then reads stats. */
  advance(): Promise<void>;
  /** Whether a stats read outside `advance` must wait, as it could parse a transcript no warm has read. */
  active(threadIds: readonly string[]): boolean;
}

export function createUsageCatchUp({ sources, threadIds, settled, sinceStatsRead, paceMs, quietMs, publish, caughtUp, timed }: UsageCatchUpOptions): UsageCatchUp {
  /** Each thread a warm covered, and whether it had an observation then: a failed read that later succeeds names transcripts no warm read. */
  const warmed = new Map<string, boolean>();
  /** A warm and its stats read are running, which every other stats read and warm waits for. */
  let warming = false;
  /** Something asked for a read during that run, which earns it one more when it ends. */
  let followUp = false;
  let quietUntil = 0;
  let started = false;
  let readsLogged = false;
  let finished = false;
  /** Figures stay provisional until a stats read after the first read settles, so that read is due even with no read landing. */
  let readAfterSettle = false;
  /** The last stats read here couldn't read T3. Nothing more will arrive until it can, so it holds up nothing. */
  let unreadable = false;

  const unread = ({ reads }: ThreadReads) => [...reads.values()].some((read) => read === 'never');
  const unwarmed = ({ reads, observed }: ThreadReads) => [...reads].some(([id, read]) => read !== 'never' && warmed.get(id) !== observed.has(id));

  /** One warm and the stats read after it, whose durations the board's log names. */
  async function readStats(ids: string[], standing: ThreadReads): Promise<void> {
    warming = true;
    try {
      const warmStart = performance.now();
      const warm = await warmT3Stats(sources, ids);
      const warmMs = performance.now() - warmStart;
      const start = performance.now();
      const cpu = process.cpuUsage();
      const reads = warm.read(Date.now());
      publish(reads);
      const used = process.cpuUsage(cpu);
      // An outage retries for as long as it lasts, and its first line says enough.
      if (!unreadable || !reads.statsUnavailable) timed(`stats read took ${Math.round(performance.now() - start)} ms elapsed, ${Math.round((used.user + used.system) / 1000)} ms CPU, after warming ${warm.files} transcripts in ${Math.round(warmMs)} ms, longest ${Math.round(warm.longestMs)} ms`);
      unreadable = reads.statsUnavailable;
      if (unreadable) return;
      readAfterSettle = settled();
      for (const [id, read] of standing.reads) if (read !== 'never') warmed.set(id, standing.observed.has(id));
    } finally {
      warming = false;
    }
  }

  const advance = async (mayRead = true): Promise<void> => {
    if (Date.now() < quietUntil) return;
    const ids = threadIds();
    const standing = protocolThreadReads(ids);
    if (!standing || !ids.length && !settled()) return;
    if (!started) {
      started = true;
      timed('warmup started');
    }
    const reading = unread(standing);
    const unwarmedReads = unwarmed(standing);
    // retryAt holds a failing thread back from each demand, and nothing here asks again before the next tick.
    if (reading || unwarmedReads) standing.demand();
    if (!reading && !readsLogged) {
      readsLogged = true;
      const reads = [...standing.reads.values()];
      const failed = reads.filter((read) => read === 'failed').length;
      timed(`thread reads complete (read ${reads.length - failed}, failed ${failed}, total ${reads.length})`);
    }
    if (warming) {
      followUp = true;
      return;
    }
    const needsRead = unwarmedReads || !!ids.length && settled() && !readAfterSettle;
    if (needsRead && mayRead && sinceStatsRead() >= paceMs()) {
      await readStats(ids, standing);
      const again = followUp;
      followUp = false;
      return advance(again);
    }
    if (!finished && settled() && (unreadable || !reading && !needsRead)) {
      finished = true;
      timed('every item settled');
      caughtUp();
    }
    if (finished && !reading && !needsRead) quietUntil = Date.now() + quietMs;
  };

  return {
    advance: () => advance(),
    active(ids) {
      if (warming) return true;
      const standing = protocolThreadReads(ids);
      const waits = !standing || unread(standing) || unwarmed(standing);
      if (waits) quietUntil = 0;
      return waits;
    },
  };
}
