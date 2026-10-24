// API cost of usage records, priced as T3 Code's usage page prices them. Ported from
// pingdotgg/t3code main at f054d1b8018721bd997d99cbb918a7b17bf098a4:
// - apps/server/src/usage/usagePricing.ts: the rate table, model-name normalisation,
//   cache-rate fallbacks, speed tiers, overrides and provider-reported costs
//   (`parseRateTable`, `createOverrideRateTable`, `lookupRate`, `priceUsage`);
// - apps/server/src/usage/usageAggregation.ts: model aliases (`resolveModelAliases`,
//   `#mapModel`), applied before a record is priced.
// Pure: item-stats.ts reads the rate table and T3's settings.

import type { UsageRecord, UsageSpeed, UsageTokenTotals } from './transcript-usage.ts';

interface TokenRates {
  inputCostPerToken: number;
  outputCostPerToken: number;
  cacheReadCostPerToken: number;
  cacheCreationCostPerToken: number;
}

/** A model's rates; LiteLLM's `*_above_272k_tokens`, `*_flex` and `*_batches` variants aren't in transcripts, so aren't priced. */
interface ModelRate extends TokenRates {
  fast: TokenRates | null;
  ultrafast: TokenRates | null;
}

export type RateTable = ReadonlyMap<string, ModelRate>;

/** A user's price for a model, per million tokens, as T3's `UsageModelPriceOverride`; omitted cache rates use the input rate. */
export interface PriceOverride {
  inputCostPerMillionTokens: number;
  outputCostPerMillionTokens: number;
  cacheReadCostPerMillionTokens?: number;
  cacheWriteCostPerMillionTokens?: number;
}

export function createOverrideRateTable(overrides: Readonly<Record<string, PriceOverride>>): RateTable {
  return new Map(
    Object.entries(overrides).map(([model, prices]) => [
      model.trim(),
      {
        inputCostPerToken: prices.inputCostPerMillionTokens / 1_000_000,
        outputCostPerToken: prices.outputCostPerMillionTokens / 1_000_000,
        cacheReadCostPerToken: (prices.cacheReadCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        cacheCreationCostPerToken: (prices.cacheWriteCostPerMillionTokens ?? prices.inputCostPerMillionTokens) / 1_000_000,
        fast: null,
        ultrafast: null,
      },
    ]),
  );
}

type LiteLlmEntry = Readonly<Record<string, unknown>>;

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Anthropic bills cache reads at a discount and cache writes at a premium. When the
 * standard tier omits them, cached input is priced as plain input rather than as free.
 */
function readTokenRates(entry: LiteLlmEntry, suffix: string, standard?: TokenRates): TokenRates | null {
  const input = finiteNumber(entry[`input_cost_per_token${suffix}`]);
  const output = finiteNumber(entry[`output_cost_per_token${suffix}`]);
  if (input === null || output === null) return null;
  const cacheRate = (name: string, field: 'cacheReadCostPerToken' | 'cacheCreationCostPerToken') =>
    finiteNumber(entry[`${name}${suffix}`]) ??
    (standard !== undefined && standard.inputCostPerToken > 0 ? (standard[field] / standard.inputCostPerToken) * input : input);
  return {
    inputCostPerToken: input,
    outputCostPerToken: output,
    cacheReadCostPerToken: cacheRate('cache_read_input_token_cost', 'cacheReadCostPerToken'),
    cacheCreationCostPerToken: cacheRate('cache_creation_input_token_cost', 'cacheCreationCostPerToken'),
  };
}

function scaleTokenRates(rates: TokenRates, multiple: number): TokenRates {
  return {
    inputCostPerToken: rates.inputCostPerToken * multiple,
    outputCostPerToken: rates.outputCostPerToken * multiple,
    cacheReadCostPerToken: rates.cacheReadCostPerToken * multiple,
    cacheCreationCostPerToken: rates.cacheCreationCostPerToken * multiple,
  };
}

function fastMultiplier(entry: LiteLlmEntry): number | null {
  const specific = entry['provider_specific_entry'];
  if (typeof specific !== 'object' || specific === null) return null;
  const fast = finiteNumber((specific as Record<string, unknown>)['fast']);
  return fast !== null && fast > 0 ? fast : null;
}

/**
 * The rate table from LiteLLM's price document. Entries without both an input and an
 * output rate are dropped: a half-priced model would under-report cost.
 */
export function parseRateTable(document: unknown): RateTable {
  const table = new Map<string, ModelRate>();
  if (typeof document !== 'object' || document === null) return table;

  for (const [name, raw] of Object.entries(document as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as LiteLlmEntry;
    const standard = readTokenRates(entry, '');
    if (standard === null) continue;
    const key = normalizeRateKey(name);
    if (key.length === 0) continue;
    const multiple = fastMultiplier(entry);
    table.set(key, {
      ...standard,
      fast: multiple === null ? readTokenRates(entry, '_priority', standard) : scaleTokenRates(standard, multiple),
      ultrafast: readTokenRates(entry, '_ultrafast', standard),
    });
  }

  // A bare name stands for its qualified entries when they all have one rate.
  const aliasCandidates = new Map<string, ModelRate | null>();
  for (const [key, rate] of table) {
    const alias = bareModelName(key);
    if (alias.length === 0 || alias === key || table.has(alias)) continue;
    const held = aliasCandidates.get(alias);
    if (held === undefined) aliasCandidates.set(alias, rate);
    else if (held !== null && !sameRate(held, rate)) aliasCandidates.set(alias, null);
  }
  for (const [alias, rate] of aliasCandidates) if (rate !== null) table.set(alias, rate);
  return table;
}

function sameTokenRates(a: TokenRates | null, b: TokenRates | null): boolean {
  if (a === null || b === null) return a === b;
  return a.inputCostPerToken === b.inputCostPerToken &&
    a.outputCostPerToken === b.outputCostPerToken &&
    a.cacheReadCostPerToken === b.cacheReadCostPerToken &&
    a.cacheCreationCostPerToken === b.cacheCreationCostPerToken;
}

function sameRate(a: ModelRate, b: ModelRate): boolean {
  return sameTokenRates(a, b) && sameTokenRates(a.fast, b.fast) && sameTokenRates(a.ultrafast, b.ultrafast);
}

function ratesAt(rate: ModelRate, speed: UsageSpeed): TokenRates {
  return (speed === 'standard' ? null : rate[speed]) ?? rate;
}

function normalizeRateKey(model: string): string {
  return model.trim().toLowerCase();
}

function bareModelName(key: string): string {
  const slash = key.lastIndexOf('/');
  return slash === -1 ? key : key.slice(slash + 1);
}

/** Drops a bracketed variant suffix such as Claude Code's 1M context tier `[1m]`: priced at the base tier. */
function stripVariantSuffix(key: string): string {
  const bracket = key.indexOf('[');
  return bracket === -1 ? key : key.slice(0, bracket);
}

/** Never billed (`<synthetic>`), or a bare family name ambiguous across generations. */
const UNPRICEABLE_MODELS = new Set(['<synthetic>', 'synthetic', 'opus', 'sonnet', 'haiku', 'fable']);

export function lookupRate(table: RateTable, model: string): ModelRate | null {
  const key = stripVariantSuffix(normalizeRateKey(model));
  const bareName = bareModelName(key);
  if (bareName.length === 0 || UNPRICEABLE_MODELS.has(bareName)) return null;
  return table.get(key) ?? null;
}

export type CostSource = 'modelPriced' | 'providerReported' | 'unpriced';

export type PricedRecord = Pick<UsageRecord, 'model' | 'totals' | 'speed' | 'reportedCostUsd'>;

function listCost(totals: UsageTokenTotals, rates: TokenRates): number {
  return totals.uncachedInputTokens * rates.inputCostPerToken +
    totals.cachedInputTokens * rates.cacheReadCostPerToken +
    totals.cacheCreationTokens * rates.cacheCreationCostPerToken +
    totals.outputTokens * rates.outputCostPerToken;
}

/**
 * A record's cost: a user's override first, then the provider's own cost, then the
 * rate table. Reasoning is inside output, so it isn't charged again.
 */
export function priceUsage(table: RateTable, record: PricedRecord, overrides?: RateTable): { costUsd: number; costSource: CostSource } {
  const { model, totals, reportedCostUsd } = record;
  const override = overrides?.get(model.trim());
  const reported = override === undefined && reportedCostUsd !== null && Number.isFinite(reportedCostUsd) ? reportedCostUsd : null;
  // T3 also splits a priced record's cost by category, which only its usage page shows.
  if (reported !== null) return { costUsd: reported, costSource: 'providerReported' };
  const rate = override ?? lookupRate(table, model);
  if (rate === null) return { costUsd: 0, costSource: 'unpriced' };
  return { costUsd: listCost(totals, ratesAt(rate, record.speed)), costSource: 'modelPriced' };
}

/** Each aliased model's final target, following chains; a model in a cycle keeps its own name. */
export function resolveModelAliases(aliases: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
  const resolved = new Map<string, string>();
  for (const model of Object.keys(aliases)) {
    const seen = new Set([model]);
    let target = aliases[model]!;
    while (Object.hasOwn(aliases, target) && !seen.has(target)) {
      seen.add(target);
      target = aliases[target]!;
    }
    if (!Object.hasOwn(aliases, target)) resolved.set(model, target);
  }
  return resolved;
}

/** What T3 prices with: its rate table, and the user's overrides and model aliases from its settings. */
export interface Pricing {
  rates: RateTable;
  overrides: RateTable;
  aliases: ReadonlyMap<string, string>;
}

/** The records' API cost, as T3 sums it; null when none of them could be priced. */
export function apiCost(records: Iterable<UsageRecord>, pricing: Pricing): number | null {
  let total = 0;
  let priced = false;
  for (const record of records) {
    const model = pricing.aliases.get(record.model) ?? record.model;
    const { costUsd, costSource } = priceUsage(pricing.rates, { ...record, model }, pricing.overrides);
    total += costUsd;
    if (costSource !== 'unpriced') priced = true;
  }
  return priced ? total : null;
}
