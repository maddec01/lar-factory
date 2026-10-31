// Item stats from T3 Code's local database, read-only (docs/adr/0005, 0007), with
// tokens from the provider transcripts of each item's threads, priced with T3's
// cached rate table. T3's queries are in t3/t3-db.ts, its settings and the paths to
// its files in t3/t3-settings.ts, and agent time in agent-time.ts. The Codex
// speed-tier read is ported from pingdotgg/t3code main at
// f054d1b8018721bd997d99cbb918a7b17bf098a4: apps/server/src/usage/CodexUsageHistory.ts
// and apps/server/src/codexModelOptions.ts; the rates loading from
// apps/server/src/usage/UsageService.ts.

import type { DatabaseSync } from 'node:sqlite';
import { isRecord } from '@lar-factory/shared';
import type { ItemStats } from '@lar-factory/shared';
import { readJsonRecord } from '../json-file.ts';
import { codexTurnSelections, threadSessions } from '../t3/t3-db.ts';
import type { CodexTurnSelection, ThreadRows, ThreadSession } from '../t3/t3-db.ts';
import { readT3Settings } from '../t3/t3-settings.ts';
import type { InstanceHome, T3Settings, TranscriptDriver } from '../t3/t3-settings.ts';
import { agentTime } from './agent-time.ts';
import { codexServiceTier } from './codex-usage.ts';
import { claudeSessionRecords, codexSessionRecords, firstCopies, scanTranscripts, totalTokens, transcriptMisses } from './transcript-usage.ts';
import type { SessionRecordsReader, TranscriptFile } from './transcript-usage.ts';
import type { UsageRecord, UsageSpeed } from './usage-record.ts';
import { apiCost, createOverrideRateTable, parseRateTable, resolveModelAliases } from './usage-pricing.ts';
import type { Pricing } from './usage-pricing.ts';

/**
 * An item's stats by repo and issue number, or null when no thread worked on it;
 * `priced` is false when the rate table couldn't be read, so no stats carry a cost.
 */
export type ItemStatsReader = ((repo: string, number: number) => ItemStats | null) & { priced: boolean };

/** Where item stats read from: T3's database, settings and price table, and the home folder `~` stands for. */
export interface StatsSources {
  db: string;
  settings: string;
  rates: string;
  home: string;
}

// The transcript reader for each provider driver whose sessions count.
const READERS: Record<TranscriptDriver, (home: string) => SessionRecordsReader> = {
  claudeAgent: claudeSessionRecords,
  codex: codexSessionRecords,
};

/**
 * T3's pricing, as UsageService.ts loads it: the LiteLLM document T3 cached in
 * `usage-model-rates.json` (`{ fetchedAtMs, document }`), with the user's price
 * overrides and model aliases from T3's settings. Null when the table is missing,
 * unreadable or empty: the board fetches no prices itself, so it shows no cost.
 */
function loadPricing(ratesPath: string, settings: T3Settings): Pricing | null {
  const rates = parseRateTable(readJsonRecord(ratesPath)?.document ?? null);
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
function withCodexServiceTiers(db: DatabaseSync, records: Map<string, UsageRecord[]>): Map<string, UsageRecord[]> {
  const pending = [...records.values()].flat().filter((record) => record.unresolvedServiceTierTurnId !== undefined);
  if (pending.length === 0) return records;
  let rows: CodexTurnSelection[];
  try {
    rows = codexTurnSelections(db, new Set(pending.map((record) => record.unresolvedServiceTierTurnId!)));
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
  return new Map([...records].map(([thread, list]) => [thread, list.map(resolve)]));
}

/**
 * Each thread's usage records from its sessions' transcripts, under the home of
 * the thread's own provider instance. A record counts once across all threads,
 * for the earliest provider thread that has it, as in T3's global dedupe.
 */
function recordsByThread(db: DatabaseSync, homes: Map<string, InstanceHome>, sessions = threadSessions(db)): Map<string, UsageRecord[]> {
  const readers = new Map<string, SessionRecordsReader>();
  const keep = firstCopies();
  const read = new Set<string>();
  const records = new Map<string, UsageRecord[]>();
  for (const { thread, driver, instance, session } of sessions) {
    const source = homes.get(instance);
    if (!source || source.driver !== driver) continue;
    const at = `${source.driver}\0${source.home}`;
    if (read.has(`${at}\0${session}`)) continue;
    read.add(`${at}\0${session}`);
    let reader = readers.get(at);
    if (!reader) readers.set(at, (reader = READERS[source.driver](source.home)));
    for (const record of reader(session)) {
      if (!keep(record)) continue;
      let list = records.get(thread);
      if (!list) records.set(thread, (list = []));
      list.push(record);
    }
  }
  return records;
}

/** The transcripts of T3's threads that itemStats would read afresh. */
export const transcriptsToRead = (db: DatabaseSync, sources: StatsSources, sessions?: ThreadSession[]): TranscriptFile[] =>
  transcriptMisses(() => recordsByThread(db, readT3Settings(sources.settings, sources.home).instanceHomes, sessions));

/**
 * An item's stats over the rows T3's database `db` gave, with each item's tokens from its threads' transcripts.
 * Throws when the database can't be read; t3/t3-reads.ts opens it.
 */
export function itemStats(db: DatabaseSync, rows: ThreadRows, sources: StatsSources, now: number, sessions?: ThreadSession[]): ItemStatsReader {
  const time = agentTime(rows, now);
  const settings = readT3Settings(sources.settings, sources.home);
  const records = withCodexServiceTiers(db, scanTranscripts(() => recordsByThread(db, settings.instanceHomes, sessions)));
  const pricing = loadPricing(sources.rates, settings);
  return Object.assign((repo: string, number: number): ItemStats | null => {
    const found = time(repo, number);
    if (!found) return null;
    const own = found.threads.flatMap((thread) => records.get(thread) ?? []);
    const costUsd = pricing ? apiCost(own, pricing) : null;
    return { agentMs: found.agentMs, wallMs: found.wallMs, tokens: totalTokens(own), ...(costUsd === null ? {} : { costUsd }) };
  }, { priced: pricing !== null });
}
