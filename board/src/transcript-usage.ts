// Token usage from Claude Code transcripts, counted as T3 Code's usage page counts it.
// Ported from pingdotgg/t3code main at f054d1b8018721bd997d99cbb918a7b17bf098a4:
// - apps/server/src/provider/Drivers/claudeUsage.ts: the record rules (`parseClaudeRecord`);
// - packages/provider-core/src/server/usage.ts: `tokenCount`, `parseTimestampMs`;
// - apps/server/src/usage/usageAggregation.ts: the global dedupe, first copy wins;
// - packages/shared/src/usageMerge.ts: total tokens (`bucketTokens`).
// A session's transcripts are <home>/projects/<cwd-slug>/<session>.jsonl and
// <home>/projects/<cwd-slug>/<session>/subagents/agent-<id>.jsonl. Every read fails
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

/** One API response's usage, as T3's `UsageRecord` for the Claude provider. */
export interface UsageRecord {
  provider: 'claude';
  timestampMs: number;
  model: string;
  sessionId: string;
  totals: UsageTokenTotals;
  /** The provider's own cost, when the transcript records one. */
  reportedCostUsd: number | null;
  speed: 'standard' | 'fast';
  /** `messageId:requestId`; null when the record has neither, so it is never deduped. */
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

function fileRecords(path: string): UsageRecord[] {
  try {
    const { mtimeMs, size } = statSync(path);
    const hit = cache.get(path);
    if (hit && hit.mtimeMs === mtimeMs && hit.size === size) return hit.records;
    const records = readFileSync(path, 'utf8').split('\n').flatMap((line) => parseClaudeLine(line) ?? []);
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
  return (session) => (SESSION.test(session) ? (index().get(session) ?? []).flatMap(fileRecords) : []);
}
