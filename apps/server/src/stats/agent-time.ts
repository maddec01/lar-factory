// An item's agent and wall time, counted from T3 Code's thread, turn, run and wait
// rows of the threads its work record holds. Pure: t3/t3-db.ts reads the rows.

import type { ThreadRows, TurnRow } from '../t3/t3-db.ts';
import { latestActivity } from '../threads/item-threads.ts';
import { length, merged, minus } from './intervals.ts';
import type { Interval } from './intervals.ts';

/** An item's time in milliseconds, and the threads that worked on it. */
interface AgentTime {
  agentMs: number;
  wallMs: number;
  threads: string[];
}

/** An item's time over its work record's thread IDs and their children, or null when none of them is in T3. */
export type AgentTimeReader = (threadIds: readonly string[]) => AgentTime | null;

function add<V>(map: Map<string, V[]>, key: string, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Counts each item's time from the rows once, at `now`, and returns a lookup over it. */
export function agentTime(rows: ThreadRows, now: number): AgentTimeReader {
  const { threads, turns, runs, waits, lastMessages, active } = rows;
  const known = new Set(threads.map((t) => t.id));
  const threadsByRoot = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const { id, root, parent } of threads) {
    add(threadsByRoot, typeof root === 'string' ? root : id, id);
    if (typeof parent === 'string') parentOf.set(id, parent);
  }
  const turnsByThread = new Map<string, TurnRow[]>();
  for (const turn of turns) add(turnsByThread, turn.thread, turn);
  const lastActivity = latestActivity(rows);
  const lastMessage = new Map<string, number>();
  for (const { thread, at } of lastMessages) {
    const ms = Date.parse(at ?? '');
    if (Number.isFinite(ms)) lastMessage.set(thread, ms);
  }
  const waitsByTurn = new Map<string, Interval[]>();
  for (const wait of waits) {
    const start = Date.parse(wait.createdAt ?? '');
    const end = wait.resolvedAt ? Date.parse(wait.resolvedAt) : now;
    if (Number.isFinite(start) && Number.isFinite(end)) add(waitsByTurn, wait.turn, [start, end]);
  }
  // Each turn's next start on its provider thread, which ends an earlier turn T3 never closed.
  const nextStart = new Map<string, number>();
  const turnsByProviderThread = new Map<string, TurnRow[]>();
  for (const turn of turns) add(turnsByProviderThread, turn.providerThread, turn);
  for (const group of turnsByProviderThread.values()) {
    const starts = group.map((turn) => Date.parse(turn.startedAt ?? '')).filter(Number.isFinite);
    for (const turn of group) {
      const start = Date.parse(turn.startedAt ?? '');
      const later = starts.filter((at) => at > start);
      if (later.length) nextStart.set(turn.id, Math.min(...later));
    }
  }
  // An open turn runs up to now while it is its active provider thread's latest; one
  // T3 never closed (its run failed or was abandoned) stops at the next turn's start
  // on its provider thread, or else at the thread's latest activity.
  const turnEnd = (turn: TurnRow): number => {
    if (turn.completedAt) return Date.parse(turn.completedAt);
    const next = nextStart.get(turn.id);
    if (next !== undefined) return next;
    return active.has(turn.providerThread) ? now : (lastActivity.get(turn.thread) ?? -Infinity);
  };

  // A running subagent counts up to its latest message, or not at all before one.
  const runsByThread = new Map<string, Interval[]>();
  for (const run of runs) {
    const start = Date.parse(run.startedAt ?? '');
    const end = run.completedAt ? Date.parse(run.completedAt) : (lastMessage.get(run.thread) ?? start);
    if (Number.isFinite(start) && Number.isFinite(end)) add(runsByThread, run.thread, [start, end]);
  }
  // A thread's work: its turns less waits on the user, or, with no turns, its subagent runs.
  const work = (thread: string): Interval[] => {
    const own = turnsByThread.get(thread);
    if (!own) return merged(runsByThread.get(thread) ?? []);
    return own.flatMap((turn): Interval[] => {
      const start = Date.parse(turn.startedAt ?? '');
      return Number.isFinite(start) ? minus([[start, turnEnd(turn)]], waitsByTurn.get(turn.id) ?? []) : [];
    });
  };

  return (threadIds) => {
    const own = [...new Set(threadIds.filter((id) => known.has(id)).flatMap((id) => [id, ...(threadsByRoot.get(id) ?? [])]))];
    if (!own.length) return null;
    // A root adds all its work; a child only its work outside its direct parent's.
    let agentMs = 0;
    for (const thread of own) {
      const parent = parentOf.get(thread);
      agentMs += length(parent ? minus(work(thread), work(parent)) : work(thread));
    }
    // Wall time: the union of every thread's work, so parallel work counts once.
    const wallMs = length(merged(own.flatMap(work)));
    return { agentMs, wallMs, threads: own };
  };
}
