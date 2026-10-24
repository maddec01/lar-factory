// An item's agent and wall time, counted from T3 Code's thread, turn, run and wait
// rows (docs/adr/0005, 0008). Pure: t3/t3-db.ts reads the rows.

import type { AgentTimeRows, TurnRow } from '../t3/t3-db.ts';
import { length, merged, minus } from './intervals.ts';
import type { Interval } from './intervals.ts';

/** An item's time in milliseconds, and the threads that worked on it. */
interface AgentTime {
  agentMs: number;
  wallMs: number;
  threads: string[];
}

/** An item's time by repo and issue number, or null when no thread worked on it. */
export type AgentTimeReader = (repo: string, number: number) => AgentTime | null;

// `$mux-work <ref>` or `/mux-work <ref>` on any line, or a message starting `Build <ref>`.
const WORK_REF = /(?:^|\s)[$/]mux-work ([\w.-]+\/[\w.-]+)#(\d+)/;
const BUILD_REF = /^Build ([\w.-]+\/[\w.-]+)#(\d+)/;

/** The issue a thread's first user message names first, as lowercase `owner/repo#n`. */
function namedIssue(text: string): string | null {
  // `Build <ref>` can only start the message, so it always comes first.
  const ref = BUILD_REF.exec(text) ?? WORK_REF.exec(text);
  return ref ? issueKey(ref[1]!, ref[2]!) : null;
}

/** GitHub owner and repo names ignore case. */
function issueKey(repo: string, number: string | number): string {
  return `${repo.toLowerCase()}#${number}`;
}

function add<V>(map: Map<string, V[]>, key: string, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Counts each item's time from the rows once, at `now`, and returns a lookup over it. */
export function agentTime(rows: AgentTimeRows, now: number): AgentTimeReader {
  const { threads, turns, runs, waits, lastMessages, active } = rows;
  const rootsByIssue = new Map<string, string[]>();
  const threadsByRoot = new Map<string, string[]>();
  const parentOf = new Map<string, string>();
  for (const { id, root, parent, text } of threads) {
    const issue = typeof text === 'string' ? namedIssue(text) : null;
    if (issue) add(rootsByIssue, issue, id);
    add(threadsByRoot, typeof root === 'string' ? root : id, id);
    if (typeof parent === 'string') parentOf.set(id, parent);
  }
  const turnsByThread = new Map<string, TurnRow[]>();
  for (const turn of turns) add(turnsByThread, turn.thread, turn);
  const threadOfTurn = new Map(turns.map((turn) => [turn.id, turn.thread]));
  // Each thread's latest activity: its latest message, turn or wait time.
  const lastActivity = new Map<string, number>();
  const seen = (thread: string | undefined, at: string | null) => {
    const ms = Date.parse(at ?? '');
    if (thread && Number.isFinite(ms) && ms > (lastActivity.get(thread) ?? -Infinity)) lastActivity.set(thread, ms);
  };
  const lastMessage = new Map<string, number>();
  for (const { thread, at } of lastMessages) {
    seen(thread, at);
    const ms = Date.parse(at ?? '');
    if (Number.isFinite(ms)) lastMessage.set(thread, ms);
  }
  for (const turn of turns) [turn.startedAt, turn.completedAt].forEach((at) => seen(turn.thread, at));
  const waitsByTurn = new Map<string, Interval[]>();
  for (const wait of waits) {
    [wait.createdAt, wait.resolvedAt].forEach((at) => seen(threadOfTurn.get(wait.turn), at));
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
  // A thread's work: its turns less waits on Pedro, or, with no turns, its subagent runs.
  const work = (thread: string): Interval[] => {
    const own = turnsByThread.get(thread);
    if (!own) return merged(runsByThread.get(thread) ?? []);
    return own.flatMap((turn): Interval[] => {
      const start = Date.parse(turn.startedAt ?? '');
      return Number.isFinite(start) ? minus([[start, turnEnd(turn)]], waitsByTurn.get(turn.id) ?? []) : [];
    });
  };

  return (repo, number) => {
    const matched = rootsByIssue.get(issueKey(repo, number));
    if (!matched) return null;
    const own = [...new Set(matched.flatMap((root) => [root, ...(threadsByRoot.get(root) ?? [])]))];
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
