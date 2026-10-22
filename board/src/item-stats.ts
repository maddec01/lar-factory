// Item stats from T3 Code's local database, read-only (docs/adr/0005). Every
// read of T3's internal schema lives here, so a schema change touches one file.

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { ItemStats } from './model.ts';
import { count, subagentTokens } from './subagent-tokens.ts';
import type { SubagentTokensReader } from './subagent-tokens.ts';

/** An item's stats by repo and issue number, or null when no thread worked on it. */
export type ItemStatsReader = (repo: string, number: number) => ItemStats | null;

/** T3's database: `T3_STATE_DB`, or its usual place under the home folder. */
export function statsDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_STATE_DB || `${env.HOME ?? ''}/.t3/userdata/statev2.sqlite`;
}

// A root thread with its first user message.
const ROOTS = `
SELECT t.thread_id AS id, (
  SELECT json_extract(m.payload_json, '$.text') FROM orchestration_v2_projection_messages m
  WHERE m.thread_id = t.thread_id AND m.role = 'user' ORDER BY m.created_at LIMIT 1
) AS text
FROM orchestration_v2_projection_threads t
WHERE json_extract(t.payload_json, '$.lineage.relationshipToParent') IS NULL`;

const LINEAGE = `
SELECT thread_id AS id, json_extract(payload_json, '$.lineage.rootThreadId') AS root
FROM orchestration_v2_projection_threads`;

const TURNS = `
SELECT provider_turn_id AS id, thread_id AS thread, provider_thread_id AS providerThread,
  started_at AS startedAt, completed_at AS completedAt,
  json_extract(payload_json, '$.turnTokenUsage.inputTokens') AS input,
  json_extract(payload_json, '$.turnTokenUsage.cachedInputTokens') AS cached,
  json_extract(payload_json, '$.turnTokenUsage.outputTokens') AS output,
  json_extract(payload_json, '$.turnTokenUsage.usageStatus') AS usageStatus
FROM orchestration_v2_projection_provider_turns`;

const WAITS = `
SELECT provider_turn_id AS turn, created_at AS createdAt, resolved_at AS resolvedAt
FROM orchestration_v2_projection_runtime_requests`;

// Each thread's latest message, for capping a turn T3 never closed.
const LAST_MESSAGES = `
SELECT thread_id AS thread, max(created_at) AS at FROM orchestration_v2_projection_messages GROUP BY thread_id`;

// Provider threads with a turn in flight. A turn whose run failed can stay open
// for good, its provider thread back to idle.
const ACTIVE = `
SELECT provider_thread_id AS id FROM orchestration_v2_projection_provider_threads WHERE status = 'active'`;

// Each thread's Claude session IDs, one per provider thread. Claude's provider_native
// child threads have no turns or provider threads: their tokens are only in the
// sessions' subagent transcripts. App-owned and Codex children count through turns.
const SESSIONS = `
SELECT thread_id AS thread, json_extract(payload_json, '$.nativeThreadRef.nativeId') AS session
FROM orchestration_v2_projection_provider_threads`;

interface Turn {
  id: string;
  thread: string;
  providerThread: string;
  startedAt: string | null;
  completedAt: string | null;
  input: unknown;
  cached: unknown;
  output: unknown;
  usageStatus: unknown;
}

// `$mux-work <ref>` or `/mux-work <ref>` on any line, or a message starting `Build <ref>`.
const WORK_REF = /(?:^|\s)[$/]mux-work ([\w.-]+\/[\w.-]+)#(\d+)/g;
const BUILD_REF = /^Build ([\w.-]+\/[\w.-]+)#(\d+)/;

/** The issues a thread's first user message names, as `owner/repo#n`. */
function namedIssues(text: string): string[] {
  const refs = [...text.matchAll(WORK_REF)].map((m) => `${m[1]}#${m[2]}`);
  const build = BUILD_REF.exec(text);
  return build ? [...refs, `${build[1]}#${build[2]}`] : refs;
}

function add<V>(map: Map<string, V[]>, key: string, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Total length of the intervals, overlaps counted once. */
function covered(intervals: [number, number][]): number {
  let total = 0;
  let reach = -Infinity;
  for (const [start, end] of intervals.sort((a, b) => a[0] - b[0])) {
    const from = Math.max(start, reach);
    if (end > from) total += end - from;
    reach = Math.max(reach, end);
  }
  return total;
}

/** The provider threads running a turn now; none when T3 doesn't say, so open turns are capped. */
function activeProviderThreads(db: DatabaseSync): Set<string> {
  try {
    return new Set((db.prepare(ACTIVE).all() as { id: unknown }[]).flatMap(({ id }) => (typeof id === 'string' ? [id] : [])));
  } catch {
    return new Set();
  }
}

/** Each thread's Claude session IDs; none when T3's provider threads can't be read. */
function sessionsByThread(db: DatabaseSync): Map<string, string[]> {
  const sessions = new Map<string, string[]>();
  try {
    for (const { thread, session } of db.prepare(SESSIONS).all() as { thread: unknown; session: unknown }[]) {
      if (typeof thread === 'string' && typeof session === 'string') add(sessions, thread, session);
    }
  } catch {
    // Subagent tokens are extra; T3's own stats still stand.
  }
  return sessions;
}

/**
 * Reads the database once and returns a lookup over it, adding Claude subagent
 * tokens from the transcripts under `transcripts`. Null when there is no
 * database; 'unavailable' when it can't be read, e.g. T3 changed its schema.
 */
export function loadItemStats(path: string, transcripts: string, now: number): ItemStatsReader | 'unavailable' | null {
  if (!existsSync(path)) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const roots = db.prepare(ROOTS).all() as { id: string; text: unknown }[];
    const lineage = db.prepare(LINEAGE).all() as { id: string; root: unknown }[];
    const turns = db.prepare(TURNS).all() as unknown as Turn[];
    const waits = db.prepare(WAITS).all() as { turn: string; createdAt: string | null; resolvedAt: string | null }[];
    const lastMessages = db.prepare(LAST_MESSAGES).all() as { thread: string; at: string | null }[];
    const activity = { lastMessages, active: activeProviderThreads(db) };
    const subagents = { sessions: sessionsByThread(db), tokens: subagentTokens(transcripts) };
    return reader(roots, lineage, turns, waits, activity, subagents, now);
  } catch {
    return 'unavailable';
  } finally {
    db?.close();
  }
}

function reader(
  roots: { id: string; text: unknown }[],
  lineage: { id: string; root: unknown }[],
  turns: Turn[],
  waits: { turn: string; createdAt: string | null; resolvedAt: string | null }[],
  activity: { lastMessages: { thread: string; at: string | null }[]; active: Set<string> },
  subagents: { sessions: Map<string, string[]>; tokens: SubagentTokensReader },
  now: number,
): ItemStatsReader {
  const rootsByIssue = new Map<string, Set<string>>();
  for (const root of roots) {
    if (typeof root.text !== 'string') continue;
    for (const issue of namedIssues(root.text)) {
      rootsByIssue.set(issue, (rootsByIssue.get(issue) ?? new Set()).add(root.id));
    }
  }
  const threadsByRoot = new Map<string, string[]>();
  for (const { id, root } of lineage) add(threadsByRoot, typeof root === 'string' ? root : id, id);
  const turnsByThread = new Map<string, Turn[]>();
  for (const turn of turns) add(turnsByThread, turn.thread, turn);
  const threadOfTurn = new Map(turns.map((turn) => [turn.id, turn.thread]));
  // Each thread's latest activity: its latest message, turn or wait time.
  const lastActivity = new Map<string, number>();
  const seen = (thread: string | undefined, at: string | null) => {
    const ms = Date.parse(at ?? '');
    if (thread && Number.isFinite(ms) && ms > (lastActivity.get(thread) ?? -Infinity)) lastActivity.set(thread, ms);
  };
  for (const { thread, at } of activity.lastMessages) seen(thread, at);
  for (const turn of turns) [turn.startedAt, turn.completedAt].forEach((at) => seen(turn.thread, at));
  const waitsByTurn = new Map<string, [number, number][]>();
  for (const wait of waits) {
    [wait.createdAt, wait.resolvedAt].forEach((at) => seen(threadOfTurn.get(wait.turn), at));
    const start = Date.parse(wait.createdAt ?? '');
    const end = wait.resolvedAt ? Date.parse(wait.resolvedAt) : now;
    if (Number.isFinite(start) && Number.isFinite(end)) add(waitsByTurn, wait.turn, [start, end]);
  }
  // Each turn's next start on its provider thread, which ends an earlier turn T3 never closed.
  const nextStart = new Map<string, number>();
  const turnsByProviderThread = new Map<string, Turn[]>();
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
  const turnEnd = (turn: Turn): number => {
    if (turn.completedAt) return Date.parse(turn.completedAt);
    const next = nextStart.get(turn.id);
    if (next !== undefined) return next;
    return activity.active.has(turn.providerThread) ? now : (lastActivity.get(turn.thread) ?? -Infinity);
  };

  return (repo, number) => {
    const matched = rootsByIssue.get(`${repo}#${number}`);
    if (!matched) return null;
    const threads = new Set([...matched].flatMap((root) => [root, ...(threadsByRoot.get(root) ?? [])]));
    const stats: ItemStats = { agentMs: 0, tokens: { input: 0, cached: 0, output: 0, lowerBound: false } };
    for (const turn of [...threads].flatMap((thread) => turnsByThread.get(thread) ?? [])) {
      const start = Date.parse(turn.startedAt ?? '');
      const end = turnEnd(turn);
      if (Number.isFinite(start) && end > start) {
        const inside = (waitsByTurn.get(turn.id) ?? [])
          .map(([from, to]): [number, number] => [Math.max(from, start), Math.min(to, end)]);
        stats.agentMs += end - start - covered(inside);
      }
      stats.tokens.input += count(turn.input);
      stats.tokens.cached += count(turn.cached);
      stats.tokens.output += count(turn.output);
      if (turn.usageStatus !== 'complete') stats.tokens.lowerBound = true;
    }
    const subagentTokens = subagents.tokens([...threads].flatMap((thread) => subagents.sessions.get(thread) ?? []));
    return subagentTokens ? { ...stats, subagentTokens } : stats;
  };
}
