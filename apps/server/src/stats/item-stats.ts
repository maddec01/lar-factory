// Item stats from T3 Code's local database, read-only, with
// tokens from the provider transcripts of each item's threads, priced with T3's
// cached rate table. T3's queries are in t3/t3-db.ts, its settings and the paths to
// its files in t3/t3-settings.ts, and agent time in agent-time.ts. The Codex
// speed-tier read is ported from pingdotgg/t3code main at
// f054d1b8018721bd997d99cbb918a7b17bf098a4: apps/server/src/usage/CodexUsageHistory.ts
// and apps/server/src/codexModelOptions.ts; the rates loading from
// apps/server/src/usage/UsageService.ts.

import { readFile, stat } from 'node:fs/promises';
import { isRecord } from '@lar-factory/shared';
import type { ItemStats } from '@lar-factory/shared';
import { codexTurnSelections, readT3Db } from '../t3/t3-db.ts';
import type { CodexTurnSelection, ThreadRows, ThreadSession } from '../t3/t3-db.ts';
import { readT3Settings } from '../t3/t3-settings.ts';
import type { InstanceHome, T3Settings, TranscriptDriver } from '../t3/t3-settings.ts';
import { agentTime } from './agent-time.ts';
import { codexServiceTier } from './codex-usage.ts';
import { createReadTrace } from './read-trace.ts';
import type { ReadTrace } from './read-trace.ts';
import { claudeSessions, codexSessions, firstCopies, totalTokens, warmTranscripts } from './transcript-usage.ts';
import type { PinnedTranscripts, SessionTranscripts } from './transcript-usage.ts';
import type { UsageRecord, UsageSpeed } from './usage-record.ts';
import { apiCost, createOverrideRateTable, parseRateTable, resolveModelAliases } from './usage-pricing.ts';
import type { Pricing, RateTable } from './usage-pricing.ts';

/**
 * An item's stats over its work record's thread IDs, or null when none of them is in T3;
 * `priced` is false when the rate table couldn't be read, so no stats carry a cost.
 */
export type ItemStatsReader = ((threadIds: readonly string[]) => ItemStats | null) & { priced: boolean; parsed: number; transcripts: number };

/** How much work a stats read does between two turns of the event loop, so a board of any size keeps answering. */
export const DEDUP_RECORDS_PER_CHUNK = 5_000;
export const AGGREGATION_WORK_PER_CHUNK = 2_000;
/** An item's work beyond its records: its thread family and time, counted in records' worth of work. */
export const ITEM_WORK = 50;
const TURNS_PER_QUERY = 200;

/** Where item stats read from: T3's database, settings and price table, and the home folder `~` stands for. */
export interface StatsSources {
  db: string;
  settings: string;
  rates: string;
  home: string;
}

// How each provider driver whose sessions count lists its transcripts.
const DISCOVERY: Record<TranscriptDriver, (home: string, trace: ReadTrace) => Promise<SessionTranscripts>> = {
  claudeAgent: claudeSessions,
  codex: codexSessions,
};

/** The rate table as last read, kept until the file changes: the document runs to megabytes. */
let rateTable: { path: string; mtimeMs: number; size: number; rates: RateTable } | undefined;

async function readRates(path: string, trace: ReadTrace): Promise<RateTable> {
  try {
    const { mtimeMs, size } = await trace.wait(stat(path));
    if (rateTable?.path === path && rateTable.mtimeMs === mtimeMs && rateTable.size === size) return rateTable.rates;
    const document: unknown = JSON.parse(await trace.wait(readFile(path, 'utf8')));
    const rates = parseRateTable(isRecord(document) ? document.document ?? null : null);
    rateTable = { path, mtimeMs, size, rates };
    return rates;
  } catch {
    return new Map();
  }
}

/**
 * T3's pricing, as UsageService.ts loads it: the LiteLLM document T3 cached in
 * `usage-model-rates.json` (`{ fetchedAtMs, document }`), with the user's price
 * overrides and model aliases from T3's settings. Null when the table is missing,
 * unreadable or empty: the board fetches no prices itself, so it shows no cost.
 */
async function loadPricing(ratesPath: string, settings: T3Settings, trace: ReadTrace): Promise<Pricing | null> {
  const rates = await readRates(ratesPath, trace);
  if (rates.size === 0) return null;
  return {
    rates,
    overrides: createOverrideRateTable(settings.priceOverrides),
    aliases: resolveModelAliases(settings.modelAliases),
  };
}

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
function historicalTier(match: CodexTurnSelection | null | undefined, record: UsageRecord): UsageSpeed | undefined {
  if (!match || match.nativeThread !== record.sessionId) return undefined;
  const selection = modelSelection(match.selection);
  if (!selection || selection.model !== record.model) return undefined;
  const serviceTier = selection.options.get('serviceTier');
  if (serviceTier !== undefined && typeof serviceTier !== 'string') return undefined;
  // getCodexServiceTierOptionValue: the serviceTier option, else `fast` for fastMode.
  return codexServiceTier(serviceTier ?? (selection.options.get('fastMode') === true ? 'fast' : undefined));
}

/**
 * The records with each Codex speed tier T3 resolves from its own history filled
 * in. A record T3's history can't place keeps its rollout's tier; a failed read
 * leaves them all as they are, as in T3.
 */
async function withCodexServiceTiers(db: string, records: Map<string, UsageRecord[]>, trace: ReadTrace): Promise<Map<string, UsageRecord[]>> {
  const pending = new Set<string>();
  for (const list of records.values()) for (const { unresolvedServiceTierTurnId: turn } of list) if (turn !== undefined) pending.add(turn);
  if (pending.size === 0) return records;
  const turns = [...pending];
  const rows: CodexTurnSelection[] = [];
  try {
    for (let at = 0; at < turns.length; at += TURNS_PER_QUERY) {
      rows.push(...readT3Db(db, (open) => codexTurnSelections(open, turns.slice(at, at + TURNS_PER_QUERY))));
      await trace.pause();
    }
  } catch {
    return records;
  }
  // A turn ID on several rows is ambiguous.
  const byTurn = new Map<unknown, CodexTurnSelection | null>();
  for (const row of rows) byTurn.set(row.nativeTurn, byTurn.has(row.nativeTurn) ? null : row);
  const resolve = (record: UsageRecord): UsageRecord => {
    if (record.unresolvedServiceTierTurnId === undefined) return record;
    const speed = historicalTier(byTurn.get(record.unresolvedServiceTierTurnId), record);
    if (speed === undefined) return record;
    const { unresolvedServiceTierTurnId: _turn, ...rest } = record;
    return { ...rest, speed };
  };
  const resolved = new Map<string, UsageRecord[]>();
  for (const [thread, list] of records) {
    resolved.set(thread, list.map(resolve));
    await trace.pause();
  }
  return resolved;
}

/** Each session a read counts, once, in T3's order, under the home of its own provider instance. */
async function sessionsToRead(homes: Map<string, InstanceHome>, sessions: readonly ThreadSession[], trace: ReadTrace): Promise<{ thread: string; session: string; transcripts: SessionTranscripts }[]> {
  const discovered = new Map<string, SessionTranscripts>();
  const read = new Set<string>();
  const found = [];
  for (const { thread, driver, instance, session } of sessions) {
    const source = homes.get(instance);
    if (!source || source.driver !== driver) continue;
    const at = `${source.driver}\0${source.home}`;
    if (read.has(`${at}\0${session}`)) continue;
    read.add(`${at}\0${session}`);
    let transcripts = discovered.get(at);
    if (!transcripts) discovered.set(at, (transcripts = await DISCOVERY[source.driver](source.home, trace)));
    found.push({ thread, session, transcripts });
  }
  return found;
}

/**
 * Each thread's usage records from its sessions' pinned transcripts. A record counts once across all threads, for the
 * earliest provider thread that has it, as in T3's global dedupe.
 */
async function recordsByThread(found: Awaited<ReturnType<typeof sessionsToRead>>, pinned: PinnedTranscripts, trace: ReadTrace): Promise<Map<string, UsageRecord[]>> {
  const keep = firstCopies();
  const records = new Map<string, UsageRecord[]>();
  let work = 0;
  for (const { thread, session, transcripts } of found) {
    for (const file of transcripts.records(session, pinned)) {
      for (const record of file) {
        if (++work >= DEDUP_RECORDS_PER_CHUNK) {
          work = 0;
          await trace.pause();
        }
        if (!keep(record)) continue;
        let list = records.get(thread);
        if (!list) records.set(thread, (list = []));
        list.push(record);
      }
    }
  }
  return records;
}

/** What a stats read counts besides T3's rows. */
export interface ItemStatsOptions {
  /** T3's provider threads with their sessions, earliest first. */
  sessions: readonly ThreadSession[];
  /** The thread IDs of each item on the board, whose stats the read works out in chunks; any other's are worked out when asked for. */
  items?: readonly (readonly string[])[];
  trace?: ReadTrace;
}

export const threadsKey = (threadIds: readonly string[]) => threadIds.join('\0');

/**
 * An item's stats over the rows of T3's threads, with each item's tokens from its threads' transcripts, all as they
 * stood on one pass over them: a transcript that changes later waits for the next read. Throws when they can't be read.
 */
export async function itemStats(sources: StatsSources, rows: ThreadRows, now: number, { sessions, items = [], trace = createReadTrace() }: ItemStatsOptions): Promise<ItemStatsReader> {
  trace.step('discovery');
  const settings = readT3Settings(sources.settings, sources.home);
  const pricing = await loadPricing(sources.rates, settings, trace);
  const found = await sessionsToRead(settings.instanceHomes, sessions, trace);
  trace.step('warm');
  const pinned = await warmTranscripts(found.flatMap(({ session, transcripts }) => transcripts.files(session)), trace);
  trace.step('dedup');
  const records = await withCodexServiceTiers(sources.db, await recordsByThread(found, pinned, trace), trace);
  trace.step('aggregation');
  const time = agentTime(rows, now);
  const answer = (threadIds: readonly string[]): { stats: ItemStats | null; records: number } => {
    const worked = time(threadIds);
    if (!worked) return { stats: null, records: 0 };
    let total = 0;
    const own = function* () {
      for (const thread of worked.threads) {
        const list = records.get(thread);
        if (list) yield* list;
      }
    };
    for (const thread of worked.threads) total += records.get(thread)?.length ?? 0;
    const costUsd = pricing ? apiCost(own(), pricing) : null;
    return { stats: { agentMs: worked.agentMs, wallMs: worked.wallMs, tokens: totalTokens(own()), ...(costUsd === null ? {} : { costUsd }) }, records: total };
  };
  const answers = new Map<string, ItemStats | null>();
  let work = 0;
  for (const threadIds of items) {
    const key = threadsKey(threadIds);
    if (answers.has(key)) continue;
    const { stats, records: counted } = answer(threadIds);
    answers.set(key, stats);
    work += ITEM_WORK + counted;
    if (work >= AGGREGATION_WORK_PER_CHUNK) {
      work = 0;
      await trace.pause();
    }
  }
  return Object.assign((threadIds: readonly string[]): ItemStats | null => {
    const key = threadsKey(threadIds);
    const known = answers.get(key);
    if (known !== undefined) return known;
    if (answers.has(key)) return null;
    const { stats } = answer(threadIds);
    answers.set(key, stats);
    return stats;
  }, { priced: pricing !== null, parsed: pinned.parsed, transcripts: pinned.records.size });
}
