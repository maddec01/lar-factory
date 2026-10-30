// An item's T3 Code threads: the root threads whose first user message names it,
// each with where it stands (docs/adr/0005). t3/t3-db.ts reads the rows, and
// t3/t3-reads.ts opens the database; this file is pure.

import type { ItemThread, ThreadState } from '@lar-factory/shared';
import type { ThreadRows, TurnRow } from '../t3/t3-db.ts';

/** An item's threads by repo and issue number, newest first; empty when no thread names it. */
export type ItemThreadsReader = (repo: string, number: number) => ItemThread[];

// `$lar-work <ref>` or `/lar-work <ref>` on any line, or a message starting `Build <ref>`.
const WORK_REF = /(?:^|\s)[$/]lar-(?:shape|work) ([\w.-]+\/[\w.-]+)#(\d+)/;
const BUILD_REF = /^Build ([\w.-]+\/[\w.-]+)#(\d+)/;

/** The issue a thread's first user message names first, as lowercase `owner/repo#n`. */
export function namedIssue(text: string): string | null {
  // `Build <ref>` can only start the message, so it always comes first.
  const ref = BUILD_REF.exec(text) ?? WORK_REF.exec(text);
  return ref ? issueKey(ref[1]!, ref[2]!) : null;
}

/** GitHub owner and repo names ignore case. */
export function issueKey(repo: string, number: string | number): string {
  return `${repo.toLowerCase()}#${number}`;
}

/** Each thread's latest activity in milliseconds: its latest message, turn or runtime request time. */
export function latestActivity({ turns, waits, lastMessages }: Pick<ThreadRows, 'turns' | 'waits' | 'lastMessages'>): Map<string, number> {
  const latest = new Map<string, number>();
  const seen = (thread: string | undefined, at: string | null) => {
    const ms = Date.parse(at ?? '');
    if (thread && Number.isFinite(ms) && ms > (latest.get(thread) ?? -Infinity)) latest.set(thread, ms);
  };
  for (const { thread, at } of lastMessages) seen(thread, at);
  for (const turn of turns) [turn.startedAt, turn.completedAt].forEach((at) => seen(turn.thread, at));
  const threadOfTurn = new Map(turns.map((turn) => [turn.id, turn.thread]));
  for (const wait of waits) [wait.createdAt, wait.resolvedAt].forEach((at) => seen(threadOfTurn.get(wait.turn), at));
  return latest;
}

/** Reads each item's threads from the rows once and returns a lookup over them. */
export function itemThreads(rows: ThreadRows): ItemThreadsReader {
  const { threads, turns, waits, active } = rows;
  const updated = latestActivity(rows);
  const asking = new Set(waits.flatMap((wait) => (wait.resolvedAt ? [] : [wait.turn])));
  const newest = new Map<string, TurnRow>();
  for (const turn of turns) {
    const previous = newest.get(turn.thread);
    if (!previous || Date.parse(turn.startedAt ?? '') > Date.parse(previous.startedAt ?? '')) newest.set(turn.thread, turn);
  }
  const state = (thread: string): ThreadState => {
    const turn = newest.get(thread);
    if (!turn) return 'done';
    if (['interrupted', 'failed', 'cancelled'].includes(turn.status)) return 'stopped';
    if (asking.has(turn.id)) return 'needs you';
    if (turn.completedAt) return 'done';
    // A failed run can leave an open turn behind after its provider thread returns to idle.
    return active.has(turn.providerThread) ? 'running' : 'stopped';
  };

  const byIssue = new Map<string, ItemThread[]>();
  for (const { id, title, deletedAt, text } of threads) {
    const issue = deletedAt === null && typeof text === 'string' ? namedIssue(text) : null;
    const at = updated.get(id);
    if (!issue || at === undefined) continue;
    const thread = { id, title: typeof title === 'string' ? title : id, state: state(id), updated: new Date(at).toISOString() };
    byIssue.set(issue, [...(byIssue.get(issue) ?? []), thread]);
  }
  for (const list of byIssue.values()) list.sort((a, b) => b.updated.localeCompare(a.updated));
  return (repo, number) => byIssue.get(issueKey(repo, number)) ?? [];
}
