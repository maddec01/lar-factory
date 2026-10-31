// The first-message rule: a root thread belongs to the issue its first user message names. Agent time reads by it,
// and onboarding's one-time import records each imported ticket's threads by it; work records hold every later thread
// by its T3 ID. t3/t3-db.ts reads the rows; this file is pure.

import type { ThreadRows } from '../t3/t3-db.ts';

/** A thread the first-message rule gives a ticket, with what it does for the ticket's record. */
export interface NamedThread {
  threadId: string;
  purpose: 'build' | 'shape';
}

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

/**
 * Each issue's live root threads by the first-message rule, oldest activity first, as a lookup by repo and issue
 * number. A thread whose first message starts `Build <ref>` builds; any other shapes.
 */
export function namedThreads(rows: ThreadRows): (repo: string, number: number) => NamedThread[] {
  const updated = latestActivity(rows);
  const byIssue = new Map<string, (NamedThread & { at: number })[]>();
  for (const { id, deletedAt, text } of rows.threads) {
    const issue = deletedAt === null && typeof text === 'string' ? namedIssue(text) : null;
    if (!issue) continue;
    const thread = { threadId: id, purpose: BUILD_REF.test(text as string) ? 'build' as const : 'shape' as const, at: updated.get(id) ?? 0 };
    byIssue.set(issue, [...(byIssue.get(issue) ?? []), thread]);
  }
  for (const list of byIssue.values()) list.sort((a, b) => a.at - b.at);
  return (repo, number) => (byIssue.get(issueKey(repo, number)) ?? []).map(({ threadId, purpose }) => ({ threadId, purpose }));
}
