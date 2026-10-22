// Token usage from Claude Code transcripts and Codex sessions, counted as T3 Code's
// usage page counts it. Ported from pingdotgg/t3code main at f054d1b8018721bd997d99cbb918a7b17bf098a4:
// - apps/server/src/provider/Drivers/claudeUsage.ts: the Claude record rules (`parseClaudeRecord`);
// - apps/server/src/provider/Drivers/codexUsage.ts: the Codex record rules (`parseCodexRecord`),
//   its line markers and its scan state;
// - packages/provider-core/src/server/usage.ts: `tokenCount`, `parseTimestampMs`;
// - apps/server/src/usage/UsageService.ts: dedupe keys for a Codex session found in
//   several files (`sharedSessions`);
// - apps/server/src/usage/usageAggregation.ts: the global dedupe, first copy wins;
// - packages/shared/src/usageMerge.ts: total tokens (`bucketTokens`).
// A Claude session's transcripts are <home>/projects/<cwd-slug>/<session>.jsonl and
// <home>/projects/<cwd-slug>/<session>/subagents/agent-<id>.jsonl. A Codex session's
// are <sessions>/<yyyy>/<mm>/<dd>/rollout-<time>-<session>.jsonl. Every read fails
// soft: a missing or garbled transcript only leaves its records out.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** A record's tokens by category; reasoning is inside output, as T3 has it. */
export interface UsageTokenTotals {
  uncachedInputTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export type UsageSpeed = 'standard' | 'fast' | 'ultrafast';

/** One API response's usage, as T3's `UsageRecord` for the Claude and Codex providers. */
export interface UsageRecord {
  provider: 'claude' | 'codex';
  timestampMs: number;
  model: string;
  sessionId: string;
  totals: UsageTokenTotals;
  /** The provider's own cost, when the transcript records one. */
  reportedCostUsd: number | null;
  speed: UsageSpeed;
  /** A Codex turn whose speed tier only T3's own history can tell. */
  unresolvedServiceTierTurnId?: string;
  /** Claude: `messageId:requestId`. Null when nothing identifies the record, so it is never deduped. */
  dedupeKey: string | null;
}

// Claude Code uses this model for local placeholders that never reached the API.
const CLAUDE_SYNTHETIC_MODEL = '<synthetic>';

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

/** A transcript line's usage record, or null for any line T3 doesn't count. */
export function parseClaudeLine(line: string): UsageRecord | null {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(record) || record.type !== 'assistant') return null;
  const message = record.message;
  if (!isObject(message)) return null;
  const usage = message.usage;
  if (!isObject(usage)) return null;
  const timestampMs = parseTimestampMs(record.timestamp);
  if (timestampMs === null) return null;
  const model = typeof message.model === 'string' ? message.model : '';
  if (model.length === 0 || model === CLAUDE_SYNTHETIC_MODEL) return null;
  const messageId = typeof message.id === 'string' ? message.id : null;
  const requestId = typeof record.requestId === 'string' ? record.requestId : null;
  const cost = record.costUSD;
  return {
    provider: 'claude',
    timestampMs,
    model,
    sessionId: typeof record.sessionId === 'string' ? record.sessionId : '',
    totals: {
      uncachedInputTokens: tokenCount(usage.input_tokens),
      cachedInputTokens: tokenCount(usage.cache_read_input_tokens),
      cacheCreationTokens: tokenCount(usage.cache_creation_input_tokens),
      outputTokens: tokenCount(usage.output_tokens),
      // Anthropic folds thinking tokens into output and does not break them out.
      reasoningTokens: 0,
    },
    reportedCostUsd: typeof cost === 'number' && Number.isFinite(cost) ? cost : null,
    speed: usage.speed === 'fast' ? 'fast' : 'standard',
    dedupeKey: messageId === null && requestId === null ? null : `${messageId ?? ''}:${requestId ?? ''}`,
  };
}

/** A Codex `token_count` usage, valid as T3's `CodexTokenUsage` schema checks it. */
interface CodexTokenUsage {
  input_tokens: number;
  cached_input_tokens: number;
  cache_write_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  total_tokens: number;
}

const CODEX_USAGE_FIELDS: (keyof CodexTokenUsage)[] = [
  'input_tokens', 'cached_input_tokens', 'cache_write_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens',
];

const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

function readCodexTokenUsage(value: unknown): CodexTokenUsage | null {
  if (!isObject(value) || Array.isArray(value)) return null;
  const input = value.input_tokens;
  const output = value.output_tokens;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  const usage: Record<keyof CodexTokenUsage, unknown> = {
    input_tokens: input,
    cached_input_tokens: value.cached_input_tokens === undefined ? 0 : value.cached_input_tokens,
    cache_write_input_tokens: value.cache_write_input_tokens === undefined ? 0 : value.cache_write_input_tokens,
    output_tokens: output,
    reasoning_output_tokens: value.reasoning_output_tokens === undefined ? 0 : value.reasoning_output_tokens,
    total_tokens: value.total_tokens === undefined ? input + output : value.total_tokens,
  };
  if (!CODEX_USAGE_FIELDS.every((key) => isCount(usage[key]))) return null;
  const valid = usage as CodexTokenUsage;
  return valid.cached_input_tokens + valid.cache_write_input_tokens <= valid.input_tokens &&
    valid.reasoning_output_tokens <= valid.output_tokens &&
    valid.total_tokens >= valid.input_tokens + valid.output_tokens
    ? valid
    : null;
}

function advanceCodexUsage(previous: CodexTokenUsage | null, last: CodexTokenUsage): CodexTokenUsage | null {
  return readCodexTokenUsage(Object.fromEntries(CODEX_USAGE_FIELDS.map((key) => [key, (previous?.[key] ?? 0) + last[key]])));
}

const sameUsage = (a: CodexTokenUsage, b: CodexTokenUsage): boolean => CODEX_USAGE_FIELDS.every((key) => a[key] === b[key]);

/**
 * What a Codex rollout's earlier lines tell its later ones: `token_count` events
 * carry no model or speed tier, so the model is carried forward from the latest
 * `turn_context` and the tier from the latest `thread_settings_applied`.
 */
export interface CodexScanState {
  model: string;
  speed: UsageSpeed;
  sessionId: string;
  lastUsageSignature: string | null;
  lastCumulativeUsage: CodexTokenUsage | null;
  malformedRecords: number;
  sawSessionMeta: boolean;
  modelProvider: string;
  turnId: string;
  sawThreadSettings: boolean;
  suppressingForkCopies: boolean;
  forkCopyAnchorMs: number;
}

export function initialCodexScanState(): CodexScanState {
  return {
    model: '', speed: 'standard', sessionId: '', lastUsageSignature: null, lastCumulativeUsage: null, malformedRecords: 0,
    sawSessionMeta: false, modelProvider: '', turnId: '', sawThreadSettings: false, suppressingForkCopies: false, forkCopyAnchorMs: 0,
  };
}

// A forked or subagent rollout opens with its parent's history copied in, every
// line re-stamped to the fork instant and written in one burst; the child's own
// first usage only lands after a real model turn.
const FORK_COPY_MAX_GAP_MS = 1000;

function isForkedSessionMeta(payload: Record<string, unknown>): boolean {
  if (typeof payload.forked_from_id === 'string') return true;
  const subagent = isObject(payload.source) ? payload.source.subagent : undefined;
  const spawn = isObject(subagent) ? subagent.thread_spawn : undefined;
  return isObject(spawn) && typeof spawn.parent_thread_id === 'string';
}

// Codex omits the tier when none was requested, which bills as standard; `fast` is an alias of `priority`.
function codexSpeed(serviceTier: unknown): UsageSpeed {
  if (serviceTier === 'priority' || serviceTier === 'fast') return 'fast';
  if (serviceTier === 'ultrafast') return 'ultrafast';
  return 'standard';
}

/**
 * A Codex rollout line's usage record, or null for any line T3 doesn't count,
 * updating `state` with what the line tells later ones. Cumulative counters
 * check each request's delta; older events without them are deduped against
 * the previous request.
 */
export function parseCodexLine(line: string, state: CodexScanState): UsageRecord | null {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isObject(record)) return null;
  const payload = record.payload;
  if (!isObject(payload)) return null;

  if (record.type === 'session_meta') {
    // Only the first meta is this file's own session; a fork repeats its ancestors' after it.
    if (state.sawSessionMeta) return null;
    state.sawSessionMeta = true;
    const id = payload.id ?? payload.session_id;
    if (typeof id === 'string') state.sessionId = id;
    if (typeof payload.model_provider === 'string') state.modelProvider = payload.model_provider;
    const metaTimestampMs = parseTimestampMs(record.timestamp);
    if (metaTimestampMs !== null && isForkedSessionMeta(payload)) {
      state.suppressingForkCopies = true;
      state.forkCopyAnchorMs = metaTimestampMs;
    }
    return null;
  }

  if (record.type === 'turn_context') {
    if (typeof payload.model === 'string') state.model = payload.model;
    state.turnId = typeof payload.turn_id === 'string' && typeof payload.model === 'string' && payload.model.length > 0 ? payload.turn_id : '';
    return null;
  }

  if (payload.type === 'thread_settings_applied') {
    state.sawThreadSettings = true;
    if (isObject(payload.thread_settings)) state.speed = codexSpeed(payload.thread_settings.service_tier);
    return null;
  }

  if (payload.type !== 'token_count' || !isObject(payload.info)) return null;
  const info = payload.info;

  // Codex may re-emit these counters once the model or timestamp is known.
  const timestampMs = parseTimestampMs(record.timestamp);
  if (timestampMs === null || state.model.length === 0) return null;

  const last = readCodexTokenUsage(info.last_token_usage);
  const hasCumulative = info.total_token_usage !== undefined && info.total_token_usage !== null;
  const cumulative = hasCumulative ? readCodexTokenUsage(info.total_token_usage) : null;

  if (state.suppressingForkCopies) {
    if (timestampMs - state.forkCopyAnchorMs < FORK_COPY_MAX_GAP_MS) {
      state.forkCopyAnchorMs = timestampMs;
      // Copied history is billed in the parent, but sets the child's baseline.
      const signature = last === null ? null : JSON.stringify(last);
      if (cumulative !== null) state.lastCumulativeUsage = cumulative;
      else if (!hasCumulative && last !== null && signature !== state.lastUsageSignature) {
        state.lastCumulativeUsage = advanceCodexUsage(state.lastCumulativeUsage, last);
      }
      state.lastUsageSignature = signature;
      return null;
    }
    state.suppressingForkCopies = false;
    state.lastUsageSignature = null;
  }

  const previous = state.lastCumulativeUsage;
  // A valid snapshot is the next baseline even when its request is malformed.
  if (cumulative !== null) state.lastCumulativeUsage = cumulative;
  if (last === null || (hasCumulative && cumulative === null)) {
    state.malformedRecords += 1;
    return null;
  }

  // Zero-component counters report context size, not a request.
  if (last.input_tokens + last.output_tokens === 0) {
    state.lastUsageSignature = null;
    return null;
  }

  if (cumulative !== null && previous !== null && sameUsage(cumulative, previous)) return null;

  if (last.total_tokens !== last.input_tokens + last.output_tokens) {
    state.malformedRecords += 1;
    return null;
  }

  const signature = JSON.stringify(last);
  if (cumulative !== null) {
    // A session resumed in a new Codex process restarts its cumulative counters at this request.
    if (!sameUsage(cumulative, last) && !CODEX_USAGE_FIELDS.every((key) => cumulative[key] - (previous?.[key] ?? 0) === last[key])) {
      state.malformedRecords += 1;
      return null;
    }
  } else {
    if (signature === state.lastUsageSignature) return null;
    // Advance the expected totals so a later cumulative re-emission is stale.
    const advanced = advanceCodexUsage(previous, last);
    if (advanced === null) {
      state.malformedRecords += 1;
      return null;
    }
    state.lastCumulativeUsage = advanced;
  }
  state.lastUsageSignature = signature;

  const totals: UsageTokenTotals = {
    // Codex counts the cached portion inside input_tokens.
    uncachedInputTokens: last.input_tokens - last.cached_input_tokens - last.cache_write_input_tokens,
    cachedInputTokens: last.cached_input_tokens,
    cacheCreationTokens: last.cache_write_input_tokens,
    outputTokens: last.output_tokens,
    // Inside output_tokens, kept apart for the token mix.
    reasoningTokens: last.reasoning_output_tokens,
  };
  const usage: UsageRecord = {
    provider: 'codex',
    timestampMs,
    model: state.model,
    sessionId: state.sessionId,
    totals,
    reportedCostUsd: null,
    speed: state.speed,
    ...(!state.sawThreadSettings && state.modelProvider === 'openai' && state.sessionId.length > 0 && state.turnId.length > 0
      ? { unresolvedServiceTierTurnId: state.turnId }
      : {}),
    dedupeKey: null,
  };
  return totalTokens([usage]) === 0 ? null : usage;
}

// T3 only parses Codex lines holding one of these: the rest carry no usage or state.
const CODEX_MARKERS = /"token_count"|"turn_context"|"thread_settings_applied"|"session_meta"/;

/** A Codex rollout's records, read top to bottom with one scan state. */
function codexRecords(lines: string[]): UsageRecord[] {
  const state = initialCodexScanState();
  return lines.flatMap((line) => (CODEX_MARKERS.test(line) ? (parseCodexLine(line, state) ?? []) : []));
}

/** A Claude transcript's records; each line stands alone. */
function claudeRecords(lines: string[]): UsageRecord[] {
  return lines.flatMap((line) => parseClaudeLine(line) ?? []);
}

/** Total tokens as T3's usage page sums them: reasoning is inside output, so it isn't added again. */
export function totalTokens(records: Iterable<UsageRecord>): number {
  let total = 0;
  for (const { totals } of records) {
    total += totals.uncachedInputTokens + totals.cachedInputTokens + totals.cacheCreationTokens + totals.outputTokens;
  }
  return total;
}

/**
 * A filter keeping the first copy of each dedupe key across every record it is
 * given: Claude Code copies a message's records forward when a session is resumed
 * or forked, so one key turns up in several transcripts. Keyless records all count.
 */
export function firstCopies(): (record: UsageRecord) => boolean {
  const seen = new Set<string>();
  return ({ dedupeKey }) => {
    if (dedupeKey === null) return true;
    if (seen.has(dedupeKey)) return false;
    seen.add(dedupeKey);
    return true;
  };
}

// Each transcript's records, kept until the file changes.
const cache = new Map<string, { mtimeMs: number; size: number; records: UsageRecord[] }>();

function list(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function fileRecords(path: string, parse: (lines: string[]) => UsageRecord[]): UsageRecord[] {
  try {
    const { mtimeMs, size } = statSync(path);
    const hit = cache.get(path);
    if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.records;
    const records = parse(readFileSync(path, 'utf8').split('\n'));
    cache.set(path, { mtimeMs, size, records });
    return records;
  } catch {
    return [];
  }
}

const SESSION = /^[\w-]+$/;
const MAIN = /^([\w-]+)\.jsonl$/;
const SUBAGENT = /^agent-[\w-]+\.jsonl$/;

/** A session's records, its own transcript first, then its subagents' in name order. */
export type SessionRecordsReader = (session: string) => UsageRecord[];

/** Reads sessions under the Claude home `home`; its projects folder is listed once, on first use. */
export function claudeSessionRecords(home: string): SessionRecordsReader {
  let files: Map<string, string[]> | undefined;
  const index = (): Map<string, string[]> => {
    if (files) return files;
    files = new Map();
    const root = join(home, 'projects');
    for (const project of list(root).sort()) {
      const dir = join(root, project);
      for (const entry of list(dir).sort()) {
        const main = MAIN.exec(entry)?.[1];
        const session = main ?? (SESSION.test(entry) ? entry : undefined);
        if (!session) continue;
        const paths = main
          ? [join(dir, entry)]
          : list(join(dir, entry, 'subagents')).filter((name) => SUBAGENT.test(name)).sort().map((name) => join(dir, entry, 'subagents', name));
        const known = files.get(session) ?? [];
        // A session's own transcript goes before its subagents'.
        files.set(session, main ? [...paths, ...known] : [...known, ...paths]);
      }
    }
    return files;
  };
  return (session) => (SESSION.test(session) ? (index().get(session) ?? []).flatMap((path) => fileRecords(path, claudeRecords)) : []);
}

// A rollout's file name ends in its session ID.
const ROLLOUT = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** Every file under `dir`, in name order, depth first. */
function walk(dir: string): string[] {
  return list(dir).sort().flatMap((name) => {
    const path = join(dir, name);
    try {
      return statSync(path).isDirectory() ? walk(path) : [path];
    } catch {
      return [];
    }
  });
}

/**
 * Gives the records of a session found in several files, as when a rollout is
 * copied as it moves, a key that matches each copy: its session, time, model and
 * tokens, with a count so equal records inside one file stay apart.
 */
function keyCopiedSessions(files: UsageRecord[][]): UsageRecord[] {
  const firstFile = new Map<string, number>();
  const shared = new Set<string>();
  files.forEach((records, index) => {
    for (const { sessionId } of records) {
      if (sessionId.length === 0) continue;
      const first = firstFile.get(sessionId);
      if (first === undefined) firstFile.set(sessionId, index);
      else if (first !== index) shared.add(sessionId);
    }
  });
  return files.flatMap((records) => {
    const occurrences = new Map<string, number>();
    return records.map((record) => {
      if (!shared.has(record.sessionId)) return record;
      const key = JSON.stringify([record.provider, record.sessionId, record.timestampMs, record.model, record.totals]);
      const occurrence = (occurrences.get(key) ?? 0) + 1;
      occurrences.set(key, occurrence);
      return { ...record, dedupeKey: `${key}:${occurrence}` };
    });
  });
}

/**
 * Reads sessions under the Codex home `home` from the rollouts in its `sessions`
 * folder, walked once, on first use. A fork's rollout opens with a copy of its
 * parent's history, which T3's rules leave out.
 */
export function codexSessionRecords(home: string): SessionRecordsReader {
  let files: Map<string, string[]> | undefined;
  const index = (): Map<string, string[]> => {
    if (files) return files;
    files = new Map();
    for (const path of walk(join(home, 'sessions'))) {
      const session = ROLLOUT.exec(path)?.[1]?.toLowerCase();
      if (session) files.set(session, [...(files.get(session) ?? []), path]);
    }
    return files;
  };
  return (session) => keyCopiedSessions((index().get(session.toLowerCase()) ?? []).map((path) => fileRecords(path, codexRecords)));
}
