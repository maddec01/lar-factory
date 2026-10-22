// Item stats from T3 Code's local database and settings, read-only (docs/adr/0005,
// 0007), with tokens from the provider transcripts of each item's threads, priced
// with T3's cached rate table. Every read of T3's internal schema, settings and
// state files lives here, so a change touches one file. The Codex speed-tier read
// is ported from pingdotgg/t3code main at f054d1b8018721bd997d99cbb918a7b17bf098a4:
// apps/server/src/usage/CodexUsageHistory.ts and apps/server/src/codexModelOptions.ts;
// the rates and settings loading from apps/server/src/usage/UsageService.ts.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ItemStats } from './model.ts';
import { claudeSessionRecords, codexSessionRecords, firstCopies, scanTranscripts, totalTokens } from './transcript-usage.ts';
import type { SessionRecordsReader, UsageRecord, UsageSpeed } from './transcript-usage.ts';
import { apiCost, createOverrideRateTable, parseRateTable, resolveModelAliases } from './usage-pricing.ts';
import type { PriceOverride, Pricing } from './usage-pricing.ts';

/**
 * An item's stats by repo and issue number, or null when no thread worked on it;
 * `priced` is false when the rate table couldn't be read, so no stats carry a cost.
 */
export type ItemStatsReader = ((repo: string, number: number) => ItemStats | null) & { priced: boolean };

/** T3's database: `T3_STATE_DB`, or its usual place under the home folder. */
export function statsDbPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_STATE_DB || `${env.HOME ?? ''}/.t3/userdata/statev2.sqlite`;
}

/** T3's settings: `T3_SETTINGS`, or their usual place under the home folder. */
export function t3SettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_SETTINGS || `${env.HOME ?? ''}/.t3/userdata/settings.json`;
}

/** T3's cached price table: `T3_USAGE_RATES`, or `usage-model-rates.json` beside T3's database, in T3's state dir. */
export function usageRatesPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.T3_USAGE_RATES || join(dirname(statsDbPath(env)), 'usage-model-rates.json');
}

/** Where item stats read from: T3's database, settings and price table, and the home folder `~` stands for. */
export interface StatsSources {
  db: string;
  settings: string;
  rates: string;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** T3's settings, or null when they can't be read. */
function readSettings(path: string): Record<string, unknown> | null {
  try {
    const settings: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return isRecord(settings) ? settings : null;
  } catch {
    return null;
  }
}

/**
 * Each Claude and Codex provider instance's home, as T3's claudeUsageReader and
 * codexUsageReader (with CodexHomeLayout's shared home) resolve it: the
 * instance's `homePath`, else `~/.claude` or `~/.codex`. The built-in
 * `claudeAgent` and `codex` instances are there even when the settings don't
 * list them or can't be read.
 */
function instanceHomes(settings: Record<string, unknown> | null, home: string): Map<string, InstanceHome> {
  const homes = new Map(Object.entries(DRIVERS).map(([driver, built]) => [driver, { driver, home: join(home, built.home) }]));
  const instances = settings?.providerInstances;
  if (!isRecord(instances)) return homes;
  for (const [id, instance] of Object.entries(instances as Record<string, { driver?: unknown; config?: { homePath?: unknown } } | null>)) {
    const driver = instance?.driver;
    if (typeof driver !== 'string' || !Object.hasOwn(DRIVERS, driver)) continue;
    const configured = typeof instance?.config?.homePath === 'string' ? instance.config.homePath.trim() : '';
    homes.set(id, { driver, home: configured ? expandHome(configured, home) : join(home, DRIVERS[driver]!.home) });
  }
  return homes;
}

const isPrice = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** The settings' `usagePriceOverrides`, keeping each entry T3's settings schema accepts. */
function priceOverrides(value: unknown): Record<string, PriceOverride> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([model, price]): [string, PriceOverride][] => {
    if (!model.trim() || !isRecord(price) || !isPrice(price.inputCostPerMillionTokens) || !isPrice(price.outputCostPerMillionTokens)) return [];
    const { cacheReadCostPerMillionTokens: read, cacheWriteCostPerMillionTokens: write } = price;
    if ((read !== undefined && !isPrice(read)) || (write !== undefined && !isPrice(write))) return [];
    return [[model.trim(), {
      inputCostPerMillionTokens: price.inputCostPerMillionTokens,
      outputCostPerMillionTokens: price.outputCostPerMillionTokens,
      ...(read === undefined ? {} : { cacheReadCostPerMillionTokens: read }),
      ...(write === undefined ? {} : { cacheWriteCostPerMillionTokens: write }),
    }]];
  }));
}

/** The settings' `usageModelAliases`, trimmed, keeping the non-empty ones. */
function modelAliases(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([model, target]): [string, string][] =>
    typeof target === 'string' && model.trim() && target.trim() ? [[model.trim(), target.trim()]] : []));
}

/**
 * T3's pricing, as UsageService.ts loads it: the LiteLLM document T3 cached in
 * `usage-model-rates.json` (`{ fetchedAtMs, document }`), with the user's price
 * overrides and model aliases from T3's settings. Null when the table is missing,
 * unreadable or empty: the board fetches no prices itself, so it shows no cost.
 */
function loadPricing(ratesPath: string, settings: Record<string, unknown> | null): Pricing | null {
  let rates;
  try {
    const cached: unknown = JSON.parse(readFileSync(ratesPath, 'utf8'));
    rates = parseRateTable(isRecord(cached) ? cached.document : null);
  } catch {
    return null;
  }
  if (rates.size === 0) return null;
  return {
    rates,
    overrides: createOverrideRateTable(priceOverrides(settings?.usagePriceOverrides)),
    aliases: resolveModelAliases(modelAliases(settings?.usageModelAliases)),
  };
}

// Each Codex turn's model selection when its attempt started running, before any
// steering changed it, as T3's CodexUsageHistory.ts reads it.
const CODEX_TURN_SELECTIONS = `
SELECT json_extract(attempt.payload_json, '$.nativeThreadId') AS nativeThread,
  json_extract(turn.payload_json, '$.nativeTurnRef.nativeId') AS nativeTurn,
  (
    SELECT json_extract(event.payload_json, '$.modelSelection')
    FROM orchestration_events AS event
    WHERE event.aggregate_kind = 'thread'
      AND event.application_event_version = 2
      AND event.stream_id = attempt.thread_id
      AND event.event_type = 'run.updated'
      AND json_extract(event.payload_json, '$.id') = attempt.run_id
      AND json_extract(event.payload_json, '$.activeAttemptId') = attempt.attempt_id
      AND json_extract(event.payload_json, '$.status') = 'running'
    ORDER BY event.sequence
    LIMIT 1
  ) AS selection
FROM orchestration_v2_projection_provider_turns AS turn
LEFT JOIN orchestration_v2_projection_run_attempts AS attempt
  ON attempt.attempt_id = turn.run_attempt_id
  AND attempt.thread_id = turn.thread_id
  AND attempt.provider_thread_id = turn.provider_thread_id
WHERE json_extract(turn.payload_json, '$.nativeTurnRef.driver') = 'codex'
  AND json_extract(turn.payload_json, '$.nativeTurnRef.nativeId') IN (SELECT value FROM json_each(?))`;

/** A model selection's model and its string or boolean option values, when it decodes as T3's `ModelSelection`. */
function modelSelection(json: unknown): { model: string; options: Map<string, unknown> } | null {
  let value: unknown;
  try {
    value = JSON.parse(typeof json === 'string' ? json : '');
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.model !== 'string' || !value.model.trim()) return null;
  if (typeof (value.instanceId ?? value.provider) !== 'string') return null;
  const options = value.options ?? [];
  if (!Array.isArray(options)) return null;
  const valid = options.every((o) => isRecord(o) && typeof o.id === 'string' && (typeof o.value === 'string' || typeof o.value === 'boolean'));
  if (!valid) return null;
  // The first option with an ID wins, as T3's getRawSelectionValueById finds it.
  const byId = new Map<string, unknown>();
  for (const { id, value: v } of options as { id: string; value: unknown }[]) if (!byId.has(id)) byId.set(id, v);
  return { model: value.model.trim(), options: byId };
}

/**
 * The speed tier T3's history gives a Codex record whose rollout doesn't say, as
 * CodexUsageHistory.ts resolves it: the turn's selection when its attempt started,
 * on the record's own session and model. Undefined when that can't be told.
 */
function historicalTier(match: { nativeThread: unknown; selection: unknown } | null | undefined, record: UsageRecord): UsageSpeed | undefined {
  if (!match || match.nativeThread !== record.sessionId) return undefined;
  const selection = modelSelection(match.selection);
  if (!selection || selection.model !== record.model) return undefined;
  const serviceTier = selection.options.get('serviceTier');
  if (serviceTier !== undefined && typeof serviceTier !== 'string') return undefined;
  // getCodexServiceTierOptionValue: the serviceTier option, else `fast` for fastMode.
  const tier = serviceTier ?? (selection.options.get('fastMode') === true ? 'fast' : undefined);
  if (tier === 'fast' || tier === 'priority') return 'fast';
  if (tier === 'ultrafast') return 'ultrafast';
  if (tier === undefined || tier === 'default' || tier === 'standard') return 'standard';
  return undefined;
}

/**
 * The records with each Codex speed tier T3 resolves from its own history filled
 * in. A record T3's history can't place keeps its rollout's tier; a failed read
 * leaves them all as they are, as in T3.
 */
function withCodexServiceTiers(db: DatabaseSync, records: Map<string, UsageRecord[]>): Map<string, UsageRecord[]> {
  const pending = [...records.values()].flat().filter((record) => record.unresolvedServiceTierTurnId !== undefined);
  if (pending.length === 0) return records;
  let rows: { nativeThread: unknown; nativeTurn: unknown; selection: unknown }[];
  try {
    const turnIds = JSON.stringify([...new Set(pending.map((record) => record.unresolvedServiceTierTurnId))]);
    rows = db.prepare(CODEX_TURN_SELECTIONS).all(turnIds) as typeof rows;
  } catch {
    return records;
  }
  // A turn ID on several rows is ambiguous.
  const byTurn = new Map<unknown, (typeof rows)[number] | null>();
  for (const row of rows) byTurn.set(row.nativeTurn, byTurn.has(row.nativeTurn) ? null : row);
  const resolve = (record: UsageRecord): UsageRecord => {
    if (record.unresolvedServiceTierTurnId === undefined) return record;
    const speed = historicalTier(byTurn.get(record.unresolvedServiceTierTurnId), record);
    if (speed === undefined) return record;
    const { unresolvedServiceTierTurnId: _turn, ...rest } = record;
    return { ...rest, speed };
  };
  return new Map([...records].map(([thread, list]) => [thread, list.map(resolve)]));
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
    const open = (db = new DatabaseSync(sources.db, { readOnly: true }));
    const roots = db.prepare(ROOTS).all() as { id: string; text: unknown }[];
    const lineage = db.prepare(LINEAGE).all() as { id: string; root: unknown }[];
    const turns = db.prepare(TURNS).all() as unknown as Turn[];
    const waits = db.prepare(WAITS).all() as { turn: string; createdAt: string | null; resolvedAt: string | null }[];
    const lastMessages = db.prepare(LAST_MESSAGES).all() as { thread: string; at: string | null }[];
    const activity = { lastMessages, active: activeProviderThreads(db) };
    const settings = readSettings(sources.settings);
    const records = withCodexServiceTiers(db, scanTranscripts(() => recordsByThread(open, instanceHomes(settings, sources.home))));
    return reader(roots, lineage, turns, waits, activity, records, loadPricing(sources.rates, settings), now);
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
  pricing: Pricing | null,
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

  return Object.assign((repo: string, number: number): ItemStats | null => {
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
    const own = [...threads].flatMap((thread) => records.get(thread) ?? []);
    const costUsd = pricing ? apiCost(own, pricing) : null;
    return { agentMs, tokens: totalTokens(own), ...(costUsd === null ? {} : { costUsd }) };
  }, { priced: pricing !== null });
}
