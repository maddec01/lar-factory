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
// soft: a missing or garbled transcript only leaves its records out. Nothing here reads
// a file synchronously: a stats read lists its transcripts, then pins each one's records
// with warmTranscripts, and counts from those alone.

import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { codexLineParser } from './codex-usage.ts';
import type { LineParser } from './codex-usage.ts';
import { createReadTrace } from './read-trace.ts';
import type { ReadTrace } from './read-trace.ts';
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

// T3 only counts assistant lines with a usage object, so a line without the key needs no parsing.
const claudeLineParser = (): LineParser => (line) => (line.includes('"usage"') ? parseClaudeLine(line) : null);

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

// Each transcript's records, kept until the file changes or a read no longer names it.
const cache = new Map<string, { mtimeMs: number; size: number; records: UsageRecord[] }>();

/** A transcript, and how its lines give its records. */
export interface TranscriptFile {
  path: string;
  parser: () => LineParser;
}

/** A read of the sizes the stream takes a transcript in, so a large one is never held as one string. */
const READ_BYTES = 128 * 1024;

/** A transcript's records, a chunk at a time, keeping only the lines a chunk leaves unfinished. */
async function fileRecords({ path, parser }: TranscriptFile, trace: ReadTrace): Promise<UsageRecord[]> {
  const parse = parser();
  const records: UsageRecord[] = [];
  const add = (line: string) => {
    const record = parse(line);
    if (record) records.push(record);
  };
  const unfinished: string[] = [];
  const chunks = createReadStream(path, { encoding: 'utf8', highWaterMark: READ_BYTES })[Symbol.asyncIterator]() as AsyncIterator<string>;
  for (;;) {
    const { value: chunk, done } = await trace.wait(chunks.next());
    if (done) break;
    let start = 0;
    for (let end = chunk.indexOf('\n'); end !== -1; start = end + 1, end = chunk.indexOf('\n', start)) {
      unfinished.push(chunk.slice(start, end));
      add(unfinished.length === 1 ? unfinished[0]! : unfinished.join(''));
      unfinished.length = 0;
    }
    if (start < chunk.length) unfinished.push(chunk.slice(start));
  }
  if (unfinished.length) add(unfinished.join(''));
  return records;
}

/** The records of one read's transcripts, as they stood when it reached each one, which later changes to a file can't reach. */
export interface PinnedTranscripts {
  records: ReadonlyMap<string, readonly UsageRecord[]>;
  /** How many transcripts the read parsed, as they weren't cached or changed since. */
  parsed: number;
}

/**
 * Pins the records of `files`, parsing those not cached or changed since, and drops the cached records of files it
 * wasn't given, as deleted transcripts, so the cache doesn't grow forever. A parse that fails leaves the file's last
 * records standing for the next read to try again.
 */
export async function warmTranscripts(files: readonly TranscriptFile[], trace: ReadTrace = createReadTrace()): Promise<PinnedTranscripts> {
  const records = new Map<string, readonly UsageRecord[]>();
  let parsed = 0;
  for (const file of files) {
    if (records.has(file.path)) continue;
    let seen;
    try {
      seen = await trace.wait(stat(file.path));
    } catch {
      continue;
    }
    const hit = cache.get(file.path);
    if (hit && hit.mtimeMs === seen.mtimeMs && hit.size === seen.size) {
      records.set(file.path, hit.records);
      continue;
    }
    try {
      const read = await fileRecords(file, trace);
      cache.set(file.path, { mtimeMs: seen.mtimeMs, size: seen.size, records: read });
      records.set(file.path, read);
      parsed++;
    } catch {
      records.set(file.path, hit?.records ?? []);
    }
  }
  for (const path of cache.keys()) if (!records.has(path)) cache.delete(path);
  return { records, parsed };
}

async function list(dir: string, trace: ReadTrace): Promise<string[]> {
  try {
    return await trace.wait(readdir(dir));
  } catch {
    return [];
  }
}

const SESSION = /^[\w-]+$/;
const MAIN = /^([\w-]+)\.jsonl$/;
const SUBAGENT = /^agent-[\w-]+\.jsonl$/;

/** Where a session's records are, and how a read's pinned transcripts give them. */
export interface SessionTranscripts {
  /** A session's transcripts, its own first, then its subagents' in name order. */
  files(session: string): TranscriptFile[];
  /** A session's records, a list a file, with no record of a list copied unless its key changes. */
  records(session: string, pinned: PinnedTranscripts): readonly (readonly UsageRecord[])[];
}

const pinnedLists = (files: readonly TranscriptFile[], { records }: PinnedTranscripts) => files.map(({ path }) => records.get(path) ?? []);

/** Lists the sessions under the Claude home `home`, each of its project folders once. */
export async function claudeSessions(home: string, trace: ReadTrace = createReadTrace()): Promise<SessionTranscripts> {
  const paths = new Map<string, string[]>();
  const root = join(home, 'projects');
  for (const project of (await list(root, trace)).sort()) {
    const dir = join(root, project);
    for (const entry of (await list(dir, trace)).sort()) {
      const main = MAIN.exec(entry)?.[1];
      const session = main ?? (SESSION.test(entry) ? entry : undefined);
      if (!session) continue;
      const found = main
        ? [join(dir, entry)]
        : (await list(join(dir, entry, 'subagents'), trace)).filter((name) => SUBAGENT.test(name)).sort().map((name) => join(dir, entry, 'subagents', name));
      const known = paths.get(session) ?? [];
      // A session's own transcript goes before its subagents'.
      paths.set(session, main ? [...found, ...known] : [...known, ...found]);
    }
  }
  const files = (session: string) => (SESSION.test(session) ? (paths.get(session) ?? []).map((path) => ({ path, parser: claudeLineParser })) : []);
  return { files, records: (session, pinned) => pinnedLists(files(session), pinned) };
}

// A rollout's file name ends in its session ID.
const ROLLOUT = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** Every file under `dir`, in name order, depth first. */
async function walk(dir: string, trace: ReadTrace): Promise<string[]> {
  const found: string[] = [];
  let entries;
  try {
    entries = await trace.wait(readdir(dir, { withFileTypes: true }));
  } catch {
    return found;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const path = join(dir, entry.name);
    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDirectory = (await trace.wait(stat(path))).isDirectory();
      } catch {
        continue;
      }
    }
    if (isDirectory) found.push(...await walk(path, trace));
    else found.push(path);
  }
  return found;
}

/**
 * Gives the records of a session found in several files, as when a rollout is
 * copied as it moves, a key that matches each copy: its session, time, model and
 * tokens, with a count so equal records inside one file stay apart.
 */
function keyCopiedSessions(files: readonly (readonly UsageRecord[])[]): readonly (readonly UsageRecord[])[] {
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
  if (shared.size === 0) return files;
  return files.map((records) => {
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
 * Lists the sessions under the Codex home `home` from the rollouts in its `sessions`
 * folder. A fork's rollout opens with a copy of its parent's history, which T3's rules leave out.
 */
export async function codexSessions(home: string, trace: ReadTrace = createReadTrace()): Promise<SessionTranscripts> {
  const paths = new Map<string, string[]>();
  for (const path of await walk(join(home, 'sessions'), trace)) {
    const session = ROLLOUT.exec(path)?.[1]?.toLowerCase();
    if (session) paths.set(session, [...(paths.get(session) ?? []), path]);
  }
  const files = (session: string) => (paths.get(session.toLowerCase()) ?? []).map((path) => ({ path, parser: codexLineParser }));
  return { files, records: (session, pinned) => keyCopiedSessions(pinnedLists(files(session), pinned)) };
}
