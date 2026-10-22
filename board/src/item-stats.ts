// Item stats from T3 Code's local database, read-only (docs/adr/0005). Every
// read of T3's internal schema lives here, so a schema change touches one file.

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { ItemStats } from './model.ts';

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
SELECT provider_turn_id AS id, thread_id AS thread, started_at AS startedAt, completed_at AS completedAt,
  json_extract(payload_json, '$.turnTokenUsage.inputTokens') AS input,
  json_extract(payload_json, '$.turnTokenUsage.cachedInputTokens') AS cached,
  json_extract(payload_json, '$.turnTokenUsage.outputTokens') AS output,
  json_extract(payload_json, '$.turnTokenUsage.usageStatus') AS usageStatus
FROM orchestration_v2_projection_provider_turns`;

const WAITS = `
SELECT provider_turn_id AS turn, created_at AS createdAt, resolved_at AS resolvedAt
FROM orchestration_v2_projection_runtime_requests`;

interface Turn {
  id: string;
  thread: string;
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

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

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

/**
 * Reads the database once and returns a lookup over it. Null when there is no
 * database; 'unavailable' when it can't be read, e.g. T3 changed its schema.
 */
export function loadItemStats(path: string, now: number): ItemStatsReader | 'unavailable' | null {
  if (!existsSync(path)) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const roots = db.prepare(ROOTS).all() as { id: string; text: unknown }[];
    const lineage = db.prepare(LINEAGE).all() as { id: string; root: unknown }[];
    const turns = db.prepare(TURNS).all() as unknown as Turn[];
    const waits = db.prepare(WAITS).all() as { turn: string; createdAt: string | null; resolvedAt: string | null }[];
    return reader(roots, lineage, turns, waits, now);
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
  const waitsByTurn = new Map<string, [number, number][]>();
  for (const wait of waits) {
    const start = Date.parse(wait.createdAt ?? '');
    const end = wait.resolvedAt ? Date.parse(wait.resolvedAt) : now;
    if (Number.isFinite(start) && Number.isFinite(end)) add(waitsByTurn, wait.turn, [start, end]);
  }

  return (repo, number) => {
    const matched = rootsByIssue.get(`${repo}#${number}`);
    if (!matched) return null;
    const threads = new Set([...matched].flatMap((root) => [root, ...(threadsByRoot.get(root) ?? [])]));
    const stats: ItemStats = { agentMs: 0, tokens: { input: 0, cached: 0, output: 0, lowerBound: false } };
    for (const turn of [...threads].flatMap((thread) => turnsByThread.get(thread) ?? [])) {
      const start = Date.parse(turn.startedAt ?? '');
      const end = turn.completedAt ? Date.parse(turn.completedAt) : now;
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
    return stats;
  };
}
