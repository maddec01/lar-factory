// Fixtures ported from T3 Code's apps/server/src/usage/usagePricing.test.ts
// (pingdotgg/t3code main at f054d1b8018721bd997d99cbb918a7b17bf098a4), with the
// costs T3 gives for them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apiCost, createOverrideRateTable, formatUsd, lookupRate, parseRateTable, priceUsage, resolveModelAliases } from '../src/usage-pricing.ts';
import type { Pricing } from '../src/usage-pricing.ts';
import type { UsageRecord, UsageSpeed } from '../src/transcript-usage.ts';

const rate = (input: number, cacheRead?: number) => ({
  input_cost_per_token: input,
  output_cost_per_token: input * 5,
  ...(cacheRead === undefined ? {} : { cache_read_input_token_cost: cacheRead }),
});

const totals = { uncachedInputTokens: 1_000_000, cachedInputTokens: 1_000_000, cacheCreationTokens: 1_000_000, outputTokens: 1_000_000, reasoningTokens: 500_000 };

const record = (model: string, reportedCostUsd: number | null = null, speed: UsageSpeed = 'standard') => ({ model, totals, reportedCostUsd, speed });

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('custom token rates go ahead of public and provider-reported costs', () => {
  const table = parseRateTable({ 'example-model': rate(1) });
  const overrides = createOverrideRateTable({
    'example-model': { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8, cacheReadCostPerMillionTokens: 0.5, cacheWriteCostPerMillionTokens: 3 },
  });
  for (const reported of [null, 99]) {
    assert.deepEqual(priceUsage(table, record('example-model', reported), overrides), { costUsd: 13.5, costSource: 'modelPriced' });
  }
});

test('an unknown model is priced by its override, with omitted cache rates at the input rate', () => {
  const overrides = createOverrideRateTable({ 'example-model': { inputCostPerMillionTokens: 2, outputCostPerMillionTokens: 8 } });
  assert.deepEqual(priceUsage(parseRateTable({}), record('example-model'), overrides), { costUsd: 14, costSource: 'modelPriced' });
});

test('explicit zero rates hold, and an override matches only the exact trimmed model ID', () => {
  const table = parseRateTable({});
  const overrides = createOverrideRateTable({ ' vendor/example-model[1m] ': { inputCostPerMillionTokens: 0, outputCostPerMillionTokens: 0 } });
  assert.deepEqual(priceUsage(table, record(' vendor/example-model[1m] ', 99), overrides), { costUsd: 0, costSource: 'modelPriced' });
  for (const model of ['example-model[1m]', 'vendor/example-model', 'vendor/Example-model[1m]', 'other/example-model[1m]']) {
    assert.equal(priceUsage(table, record(model), overrides).costSource, 'unpriced');
    assert.deepEqual(priceUsage(table, record(model, 99), overrides), { costUsd: 99, costSource: 'providerReported' });
  }
});

test('fast requests cost the model\'s published fast multiple, and overrides have no fast tier', () => {
  const table = parseRateTable({
    'claude-opus-5-5': { ...rate(4e-6, 2e-7), provider_specific_entry: { fast: 2, us: 1.1 } },
    'claude-fable-5-1': { ...rate(1e-5, 2.5e-7), provider_specific_entry: { us: 1.1 } },
  });
  const overrides = createOverrideRateTable({ 'claude-opus-5-5': { inputCostPerMillionTokens: 4, outputCostPerMillionTokens: 20 } });
  const cost = (model: string, speed: UsageSpeed, custom?: typeof overrides) => priceUsage(table, record(model, null, speed), custom).costUsd;
  close(cost('claude-opus-5-5', 'fast'), 2 * cost('claude-opus-5-5', 'standard'));
  assert.equal(cost('claude-fable-5-1', 'fast'), cost('claude-fable-5-1', 'standard'));
  assert.equal(cost('claude-opus-5-5', 'fast', overrides), cost('claude-opus-5-5', 'standard', overrides));
});

test('a fast request with a cache-write rate costs the fast multiple; a reported cost wins', () => {
  const table = parseRateTable({ 'claude-opus-5-5': { ...rate(4e-6, 4e-7), cache_creation_input_token_cost: 5e-6, provider_specific_entry: { fast: 2 } } });
  close(priceUsage(table, record('claude-opus-5-5', null, 'fast')).costUsd, 58.8);
  assert.deepEqual(priceUsage(table, record('claude-opus-5-5', 29.4, 'fast')), { costUsd: 29.4, costSource: 'providerReported' });
  assert.deepEqual(priceUsage(table, record('unknown-model', 29.4, 'fast')), { costUsd: 29.4, costSource: 'providerReported' });
});

test('Codex priority and ultrafast requests cost their published tier rates', () => {
  const table = parseRateTable({
    'gpt-6-astra': {
      ...rate(1e-5, 1e-6),
      input_cost_per_token_priority: 2e-5, output_cost_per_token_priority: 1e-4, cache_read_input_token_cost_priority: 2e-6,
      input_cost_per_token_ultrafast: 6e-5, output_cost_per_token_ultrafast: 3e-4,
    },
    'gpt-6-sol': rate(2e-6, 2e-7),
  });
  const cost = (model: string, speed: UsageSpeed) => priceUsage(table, record(model, null, speed)).costUsd;
  const standard = cost('gpt-6-astra', 'standard');
  close(cost('gpt-6-astra', 'fast'), 2 * standard);
  close(cost('gpt-6-astra', 'ultrafast'), 6 * standard);
  assert.equal(cost('gpt-6-sol', 'ultrafast'), cost('gpt-6-sol', 'standard'));
});

test('the canonical rate stays apart from a qualified one in either order', () => {
  const canonical = ['claude-fable-5', rate(1e-5, 1e-6)] as const;
  const deepInfra = ['deepinfra/anthropic/claude-fable-5', rate(1e-5)] as const;
  for (const entries of [[canonical, deepInfra], [deepInfra, canonical]]) {
    const table = parseRateTable(Object.fromEntries(entries));
    assert.equal(lookupRate(table, 'claude-fable-5')?.cacheReadCostPerToken, 1e-6);
    assert.equal(lookupRate(table, 'deepinfra/anthropic/claude-fable-5')?.cacheReadCostPerToken, 1e-5, 'a missing cache rate is the input rate');
    assert.equal(lookupRate(table, 'other/claude-fable-5'), null);
  }
});

test('a bracketed context-tier variant is priced at the base model\'s rate; names are matched in lower case', () => {
  const table = parseRateTable({ 'Claude-Fable-5-1': rate(1e-5, 2.5e-7) });
  assert.deepEqual(lookupRate(table, 'claude-fable-5-1[1m]'), lookupRate(table, 'claude-fable-5-1'));
  assert.notEqual(lookupRate(table, 'CLAUDE-FABLE-5-1'), null);
  assert.equal(lookupRate(table, 'anthropic/Claude-Fable-5-1[1m]'), null);
});

test('a bare name stands for its qualified entries only when they share one rate', () => {
  const same = parseRateTable({ 'provider-a/example-model': rate(1), 'provider-b/example-model': rate(1) });
  assert.deepEqual(lookupRate(same, 'example-model'), lookupRate(same, 'provider-a/example-model'));
  const ambiguous = parseRateTable({ 'provider-a/example-model': rate(1), 'provider-b/example-model': rate(3) });
  assert.equal(lookupRate(ambiguous, 'provider-b/example-model')?.inputCostPerToken, 3);
  assert.equal(lookupRate(ambiguous, 'example-model'), null);
});

test('half-priced entries, bare family names and synthetic records are unpriced', () => {
  const table = parseRateTable({ 'half-model': { input_cost_per_token: 1 }, opus: rate(1), 'anthropic/sonnet': rate(1), '<synthetic>': rate(1) });
  for (const model of ['half-model', 'opus', 'anthropic/sonnet', 'sonnet', '<synthetic>']) assert.equal(lookupRate(table, model), null, model);
});

test('aliases resolve through chains, and a cycle leaves its models as they are', () => {
  assert.deepEqual([...resolveModelAliases({ a: 'b', b: 'c', x: 'y', y: 'x' })], [['a', 'c'], ['b', 'c']]);
});

function usage(model: string, input: number, extra: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: 'claude', timestampMs: 0, model, sessionId: 's', dedupeKey: null, reportedCostUsd: null, speed: 'standard',
    totals: { uncachedInputTokens: input, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 0, reasoningTokens: 0 }, ...extra,
  };
}

test('an item\'s API cost sums its records, after aliases, with overrides for the aliased model', () => {
  const pricing: Pricing = {
    rates: parseRateTable({ 'claude-opus-4-1': rate(1e-5), 'gpt-6-sol': rate(2e-6) }),
    overrides: createOverrideRateTable({ 'my-proxy-model': { inputCostPerMillionTokens: 3, outputCostPerMillionTokens: 3 } }),
    aliases: resolveModelAliases({ 'internal-opus': 'claude-opus-4-1', 'proxy-alias': 'my-proxy-model' }),
  };
  const cost = apiCost([
    usage('claude-opus-4-1', 1000),
    usage('internal-opus', 1000),
    usage('proxy-alias', 1_000_000, { reportedCostUsd: 99 }),
    usage('gpt-6-sol', 1000, { speed: 'fast', reportedCostUsd: 0.5 }),
    usage('mystery-model', 1_000_000),
  ], pricing);
  close(cost ?? NaN, 0.01 + 0.01 + 3 + 0.5);
});

test('an item where nothing could be priced has no API cost', () => {
  const pricing: Pricing = { rates: parseRateTable({ 'claude-opus-4-1': rate(1e-5) }), overrides: new Map(), aliases: new Map() };
  assert.equal(apiCost([usage('mystery-model', 1000), usage('opus', 1000)], pricing), null);
  assert.equal(apiCost([], pricing), null);
  assert.equal(apiCost([usage('mystery-model', 1000, { reportedCostUsd: 0 })], pricing), 0, 'a reported cost is priced, even at zero');
});

test('costs are shown as T3 shows them', () => {
  assert.equal(formatUsd(41.2), '$41.20');
  assert.equal(formatUsd(1234.567), '$1,234.57');
  assert.equal(formatUsd(0.004), '$0.00');
});
