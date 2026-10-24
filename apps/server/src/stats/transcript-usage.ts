// Token usage from Claude Code transcripts and the transcript store over Claude and
// Codex sessions, counted as T3 Code's usage page counts it. Ported from
// pingdotgg/t3code main at f054d1b8018721bd997d99cbb918a7b17bf098a4:
// - apps/server/src/provider/Drivers/claudeUsage.ts: the Claude record rules (`parseClaudeRecord`);
// - packages/provider-core/src/server/usage.ts: `tokenCount`;
// - apps/server/src/usage/UsageService.ts: dedupe keys for a Codex session found in
//   several files (`sharedSessions`);
// - apps/server/src/usage/usageAggregation.ts: the global dedupe, first copy wins;
// - packages/shared/src/usageMerge.ts: total tokens (`bucketTokens`).
// codex-usage.ts holds the Codex record rules.
// A Claude session's transcripts are <home>/projects/<cwd-slug>/<session>.jsonl and
// <home>/projects/<cwd-slug>/<session>/subagents/agent-<id>.jsonl. A Codex session's
// are <sessions>/<yyyy>/<mm>/<dd>/rollout-<time>-<session>.jsonl. Every read fails
// soft: a missing or garbled transcript only leaves its records out.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { codexRecords } from './codex-usage.ts';
import { isObject, parseTimestampMs } from './usage-record.ts';
import type { UsageRecord } from './usage-record.ts';

// Claude Code uses this model for local placeholders that never reached the API.
const CLAUDE_SYNTHETIC_MODEL = '<synthetic>';

function tokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

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

// Each transcript's records, kept until the file changes or a scan no longer reads it.
const cache = new Map<string, { mtimeMs: number; size: number; records: UsageRecord[] }>();
// The transcripts the running scan has read.
let scanned: Set<string> | undefined;

/**
 * Runs `read`, a scan over every thread's transcripts, then drops the cached records
 * of files it didn't read, as deleted transcripts, so the cache doesn't grow forever.
 */
export function scanTranscripts<T>(read: () => T): T {
  const seen = new Set<string>();
  scanned = seen;
  try {
    const result = read();
    for (const path of cache.keys()) if (!seen.has(path)) cache.delete(path);
    return result;
  } finally {
    scanned = undefined;
  }
}

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
    scanned?.add(path);
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

/** Each session's transcript files, filled in by `fill` on first use. */
function lazyIndex(fill: (files: Map<string, string[]>) => void): () => Map<string, string[]> {
  let files: Map<string, string[]> | undefined;
  return () => {
    if (!files) fill((files = new Map()));
    return files;
  };
}

/** A session's records, its own transcript first, then its subagents' in name order. */
export type SessionRecordsReader = (session: string) => UsageRecord[];

/** Reads sessions under the Claude home `home`; its projects folder is listed once, on first use. */
export function claudeSessionRecords(home: string): SessionRecordsReader {
  const index = lazyIndex((files) => {
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
  });
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
  const index = lazyIndex((files) => {
    for (const path of walk(join(home, 'sessions'))) {
      const session = ROLLOUT.exec(path)?.[1]?.toLowerCase();
      if (session) files.set(session, [...(files.get(session) ?? []), path]);
    }
  });
  return (session) => keyCopiedSessions((index().get(session.toLowerCase()) ?? []).map((path) => fileRecords(path, codexRecords)));
}
