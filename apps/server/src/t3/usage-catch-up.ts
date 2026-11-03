// The board's one way to read stats: it brings the items' usage up to date as thread reads land, from the first read on
// and again whenever threads join, and after that runs the reads the board asks for. Only one read runs at a time, and it
// yields to the board's thread throughout, so the figures it shows come from a read that may have started a while ago.

import { loopTrace, nextTurn } from '../startup/loop-trace.ts';
import { createReadTrace } from '../stats/read-trace.ts';
import type { ReadTrace } from '../stats/read-trace.ts';
import type { StatsSources } from '../stats/item-stats.ts';
import { protocolThreadReads } from './item-execution.ts';
import type { ThreadReads } from './item-execution.ts';
import { readT3Stats } from './t3-reads.ts';
import type { StatsRead, T3Reads } from './t3-reads.ts';

/** An ordinary read's log line waits for a read this long, or one that blocked the board this long. */
const LOGGED_READ_MS = 1_000;
const LOGGED_BLOCK_MS = 50;

export interface UsageCatchUpOptions {
  sources: StatsSources;
  /** The threads of the items on the board now. */
  threadIds: () => string[];
  /** Each item's thread IDs, whose answers a read works out in chunks. */
  itemThreads: () => string[][];
  /** Changes when a read already running can no longer be shown, as it counts a thread since deleted. */
  generation: () => number;
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
  /** Logs a step of catching up with its time. */
  timed: (step: string) => void;
  /** Logs a line about an ordinary read. */
  log: (line: string) => void;
  /** A trace for each read. */
  trace?: () => ReadTrace;
}

export interface UsageCatchUp {
  /** Asks for the reads still needed and, when reads have landed and the pace allows, warms and then reads stats. */
  advance(): Promise<void>;
  /**
   * Asks for a read once catching up has finished, at the pace, or at once when `urgent`: figures a settled PR block is about to
   * freeze can't wait. Asks during a read coalesce into one follow-up.
   */
  want(urgent?: boolean): Promise<void>;
  /** Whether a read is running. */
  reading(): boolean;
  /** Whether an urgent read has yet to publish. */
  owed(): boolean;
}

/** A read's log line, naming each step and the longest block. */
function pathLine(trace: ReadTrace, { parsed, transcripts }: StatsRead): string {
  const { inputs, discovery, warm, dedup, aggregation, publish } = trace.steps;
  const ms = (value: number) => Math.round(value);
  const longest = trace.longestBlock();
  return `stats read path took ${ms(trace.elapsedMs())} ms elapsed, ${ms(trace.cpuMs())} ms CPU: inputs ${ms(inputs.elapsedMs)} ms, discovery ${ms(discovery.elapsedMs)} ms, warm ${ms(warm.elapsedMs)} ms (parsed ${parsed} of ${transcripts} transcripts), dedup ${ms(dedup.elapsedMs)} ms, aggregation ${ms(aggregation.elapsedMs)} ms, publish ${ms(publish.elapsedMs)} ms; longest block ${ms(longest.ms)} ms in ${longest.step}`;
}

export function createUsageCatchUp({ sources, threadIds, itemThreads, generation, settled, sinceStatsRead, paceMs, quietMs, publish, caughtUp, timed, log, trace: newTrace = createReadTrace }: UsageCatchUpOptions): UsageCatchUp {
  /** Each thread a read covered, and whether it had an observation then: a failed read that later succeeds names transcripts no read counted. */
  const warmed = new Map<string, boolean>();
  /** A stats read is running, which every other waits for. */
  let warming = false;
  /** Something asked for a read during that run, which earns it one more when it ends. */
  let followUp = false;
  /** The board asked for a read, which runs at the pace, or at once when urgent. */
  let wanted = false;
  let urgent = false;
  /** The running read is the urgent one, still owed until it publishes. */
  let urgentRunning = false;
  /** The first ordinary read's line always logs, so a restart shows what one costs. */
  let ordinaryLogged = false;
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

  /** Whether the threads of the items on the board are still those a read began with. A read counts its own threads alone, so any other moves shared records between items. */
  const sameThreads = (standing: ThreadReads) => {
    const now = protocolThreadReads(threadIds());
    return !!now && now.reads.size === standing.reads.size && [...now.reads.keys()].every((id) => standing.reads.has(id));
  };

  /** One stats read, whose steps the board's log names. */
  async function readStats(ids: string[], standing: ThreadReads): Promise<void> {
    warming = true;
    wanted = false;
    urgentRunning = urgent;
    urgent = false;
    const startedIn = generation();
    const trace = newTrace();
    try {
      const reads = await readT3Stats(sources, { now: Date.now(), threadIds: ids, items: itemThreads(), trace });
      if (generation() !== startedIn) {
        wanted = true;
        followUp = true;
        return;
      }
      trace.step('publish');
      urgentRunning = false;
      const same = sameThreads(standing);
      // Figures that may hold another item's records stay provisional, so they reach no retained total or PR block.
      publish(same ? reads : { ...reads, allObserved: false });
      if (!same) wanted = true;
      trace.finish();
      const { warm, dedup, aggregation, publish: shown } = trace.steps;
      // An outage retries for as long as it lasts, and its first line says enough.
      if (!finished && (!unreadable || !reads.statsUnavailable)) {
        const ms = Math.round;
        timed(`stats read took ${ms(dedup.elapsedMs + aggregation.elapsedMs + shown.elapsedMs)} ms elapsed, ${ms(dedup.cpuMs + aggregation.cpuMs + shown.cpuMs)} ms CPU, after warming ${reads.parsed} transcripts in ${ms(warm.elapsedMs)} ms, longest ${ms(warm.longestBlockMs)} ms`);
        timed(pathLine(trace, reads));
      } else if (finished && (!ordinaryLogged || trace.elapsedMs() >= LOGGED_READ_MS || trace.longestBlock().ms >= LOGGED_BLOCK_MS) && (!unreadable || !reads.statsUnavailable)) {
        ordinaryLogged = true;
        log(pathLine(trace, reads));
      }
      unreadable = reads.statsUnavailable;
      if (unreadable) return;
      readAfterSettle = settled();
      for (const [id, read] of standing.reads) if (read !== 'never') warmed.set(id, standing.observed.has(id));
    } finally {
      warming = false;
      // A read dropped before it published still owes what was urgent.
      urgent ||= urgentRunning;
      urgentRunning = false;
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
    if (!ids.length) wanted = urgent = false;
    const needsRead = unwarmedReads || wanted || !!ids.length && settled() && !readAfterSettle;
    if (needsRead && mayRead && (urgent || sinceStatsRead() >= paceMs())) {
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

  // Each ask advances in a turn of its own, apart from the refresh that asked; an urgent ask is owed at once.
  return {
    advance: () => nextTurn().then(() => loopTrace.span('usage catch-up', () => advance())),
    want(urgently = false) {
      if (!finished) return Promise.resolve();
      wanted = true;
      urgent ||= urgently;
      quietUntil = 0;
      return nextTurn().then(() => loopTrace.span('usage catch-up', () => advance()));
    },
    reading: () => warming,
    owed: () => urgent || urgentRunning,
  };
}
