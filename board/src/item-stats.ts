// Item stats from T3 Code's local database and settings, read-only (docs/adr/0005,
// 0006), with tokens from the provider transcripts of each item's threads. Every
// read of T3's internal schema and settings lives here, so a change touches one file.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ItemStats } from './model.ts';
import { claudeSessionRecords, codexSessionRecords, firstCopies, totalTokens } from './transcript-usage.ts';
import type { SessionRecordsReader, UsageRecord } from './transcript-usage.ts';

/** An item's stats by repo and issue number, or null when no thread worked on it. */
export type ItemStatsReader = (repo: string, number: number) => ItemStats | null;

/** T3's database: `T3_STATE_DB`, or its usual place under the home folder. */
export function statsDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_STATE_DB || `${env.HOME ?? ''}/.t3/userdata/statev2.sqlite`;
}

/** T3's settings: `T3_SETTINGS`, or their usual place under the home folder. */
export function t3SettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_SETTINGS || `${env.HOME ?? ''}/.t3/userdata/settings.json`;
}

/** Where item stats read from: T3's database and settings, and the home folder `~` stands for. */
export interface StatsSources {
  db: string;
  settings: string;
  home: string;
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
  started_at AS startedAt, completed_at AS completedAt
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

// Each provider thread's native session and provider instance, earliest first: a
// record forked threads share counts for the thread that produced it first. Never
// map through a turn's nativeTurnRef, which can hold a placeholder. Claude's
// provider_native child threads have no provider threads: their records are in
// their parent session's subagent transcripts. A Codex child thread has its own
// provider thread and rollout, whose copy of its parent's history isn't counted.
const SESSIONS = `
SELECT thread_id AS thread, json_extract(payload_json, '$.driver') AS driver,
  json_extract(payload_json, '$.providerInstanceId') AS instance,
  json_extract(payload_json, '$.nativeThreadRef.nativeId') AS session
FROM orchestration_v2_projection_provider_threads
ORDER BY json_extract(payload_json, '$.createdAt'), rowid`;

interface Turn {
  id: string;
  thread: string;
  providerThread: string;
  startedAt: string | null;
  completedAt: string | null;
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

// The transcript reader for each provider driver whose sessions count, and the
// home its built-in instance and any instance without a `homePath` use.
const DRIVERS: Record<string, { read: (home: string) => SessionRecordsReader; home: string }> = {
  claudeAgent: { read: claudeSessionRecords, home: '.claude' },
  codex: { read: codexSessionRecords, home: '.codex' },
};

/** `~` and `~/…` under `home`, as T3's expandHomePath reads a configured path. */
function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return isAbsolute(path) ? path : resolve(home, path);
}

/** A provider instance's transcripts: its driver and transcript home. */
interface InstanceHome {
  driver: string;
  home: string;
}

/**
 * Each Claude and Codex provider instance's home, as T3's claudeUsageReader and
 * codexUsageReader (with CodexHomeLayout's shared home) resolve it: the
 * instance's `homePath`, else `~/.claude` or `~/.codex`. The built-in
 * `claudeAgent` and `codex` instances are there even when the settings don't
 * list them or can't be read.
 */
function instanceHomes(settingsPath: string, home: string): Map<string, InstanceHome> {
  const homes = new Map(Object.entries(DRIVERS).map(([driver, built]) => [driver, { driver, home: join(home, built.home) }]));
  let instances: unknown;
  try {
    instances = (JSON.parse(readFileSync(settingsPath, 'utf8')) as { providerInstances?: unknown }).providerInstances;
  } catch {
    return homes;
  }
  if (!instances || typeof instances !== 'object') return homes;
  for (const [id, instance] of Object.entries(instances as Record<string, { driver?: unknown; config?: { homePath?: unknown } } | null>)) {
    const driver = instance?.driver;
    if (typeof driver !== 'string' || !Object.hasOwn(DRIVERS, driver)) continue;
    const configured = typeof instance?.config?.homePath === 'string' ? instance.config.homePath.trim() : '';
    homes.set(id, { driver, home: configured ? expandHome(configured, home) : join(home, DRIVERS[driver]!.home) });
  }
  return homes;
}

/**
 * Each thread's usage records from its sessions' transcripts, under the home of
 * the thread's own provider instance. A record counts once across all threads,
 * for the earliest provider thread that has it, as in T3's global dedupe.
 */
function recordsByThread(db: DatabaseSync, homes: Map<string, InstanceHome>): Map<string, UsageRecord[]> {
  const readers = new Map<string, SessionRecordsReader>();
  const keep = firstCopies();
  const read = new Set<string>();
  const records = new Map<string, UsageRecord[]>();
  for (const row of db.prepare(SESSIONS).all() as { thread: unknown; driver: unknown; instance: unknown; session: unknown }[]) {
    const { thread, driver, instance, session } = row;
    if (typeof thread !== 'string' || typeof session !== 'string' || typeof instance !== 'string') continue;
    const source = homes.get(instance);
    if (!source || source.driver !== driver) continue;
    const at = `${source.driver}\0${source.home}`;
    if (read.has(`${at}\0${session}`)) continue;
    read.add(`${at}\0${session}`);
    let reader = readers.get(at);
    if (!reader) readers.set(at, (reader = DRIVERS[source.driver]!.read(source.home)));
    for (const record of reader(session)) if (keep(record)) add(records, thread, record);
  }
  return records;
}

/**
 * Reads the database once and returns a lookup over it, with each item's tokens
 * from its threads' transcripts. Null when there is no database; 'unavailable'
 * when it can't be read, e.g. T3 changed its schema.
 */
export function loadItemStats(sources: StatsSources, now: number): ItemStatsReader | 'unavailable' | null {
  if (!existsSync(sources.db)) return null;
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(sources.db, { readOnly: true });
    const roots = db.prepare(ROOTS).all() as { id: string; text: unknown }[];
    const lineage = db.prepare(LINEAGE).all() as { id: string; root: unknown }[];
    const turns = db.prepare(TURNS).all() as unknown as Turn[];
    const waits = db.prepare(WAITS).all() as { turn: string; createdAt: string | null; resolvedAt: string | null }[];
    const lastMessages = db.prepare(LAST_MESSAGES).all() as { thread: string; at: string | null }[];
    const activity = { lastMessages, active: activeProviderThreads(db) };
    const records = recordsByThread(db, instanceHomes(sources.settings, sources.home));
    return reader(roots, lineage, turns, waits, activity, records, now);
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
  records: Map<string, UsageRecord[]>,
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
    let agentMs = 0;
    for (const turn of [...threads].flatMap((thread) => turnsByThread.get(thread) ?? [])) {
      const start = Date.parse(turn.startedAt ?? '');
      const end = turnEnd(turn);
      if (Number.isFinite(start) && end > start) {
        const inside = (waitsByTurn.get(turn.id) ?? [])
          .map(([from, to]): [number, number] => [Math.max(from, start), Math.min(to, end)]);
        agentMs += end - start - covered(inside);
      }
    }
    return { agentMs, tokens: totalTokens([...threads].flatMap((thread) => records.get(thread) ?? [])) };
  };
}
