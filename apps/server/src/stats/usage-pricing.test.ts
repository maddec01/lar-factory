// Fixtures ported from T3 Code's apps/server/src/usage/usagePricing.test.ts
// (pingdotgg/t3code main at f054d1b8018721bd997d99cbb918a7b17bf098a4), with the
// costs T3 gives for them.

import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { apiCost, createOverrideRateTable, parseRateTable, priceUsage, resolveModelAliases } from './usage-pricing.ts';
import type { Pricing } from './usage-pricing.ts';
import type { UsageRecord, UsageSpeed } from './usage-record.ts';

const rate = (input: number, cacheRead?: number) => ({
    input_cost_per_token: input,
    output_cost_per_token: input * 5,
    ...(cacheRead === undefined ? {} : { cache_read_input_token_cost: cacheRead }),
});

const totals = {
    uncachedInputTokens: 1_000_000,
    cachedInputTokens: 1_000_000,
    cacheCreationTokens: 1_000_000,
    outputTokens: 1_000_000,
    reasoningTokens: 500_000,
};

const record = (model: string, reportedCostUsd: number | null = null, speed: UsageSpeed = 'standard') => ({
    model,
    totals,
    reportedCostUsd,
    speed,
});

const close = (actual: number, expected: number) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

test('custom token rates go ahead of public and provider-reported costs', () => {
    const table = parseRateTable({ 'example-model': rate(1) });
    const overrides = createOverrideRateTable({
        'example-model': {
            inputCostPerMillionTokens: 2,
            outputCostPerMillionTokens: 8,
            cacheReadCostPerMillionTokens: 0.5,
            cacheWriteCostPerMillionTokens: 3,
        },
    });

    for (const reported of [null, 99]) {
        assert.deepEqual(priceUsage(table, record('example-model', reported), overrides), {
            costUsd: 13.5,
            costSource: 'modelPriced',
        });
    }
});

function usage(model: string, input: number, extra: Partial<UsageRecord> = {}): UsageRecord {
    return {
        provider: 'claude',
        timestampMs: 0,
        model,
        sessionId: 's',
        dedupeKey: null,
        reportedCostUsd: null,
        speed: 'standard',
        totals: {
            uncachedInputTokens: input,
            cachedInputTokens: 0,
            cacheCreationTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
        },
        ...extra,
    };
}

// oxlint-disable-next-line vitest/expect-expect -- close() asserts the cost
test("an item's API cost sums its records, after aliases, with overrides for the aliased model", () => {
    const pricing: Pricing = {
        rates: parseRateTable({ 'claude-opus-4-1': rate(1e-5), 'gpt-6-sol': rate(2e-6) }),
        overrides: createOverrideRateTable({
            'my-proxy-model': { inputCostPerMillionTokens: 3, outputCostPerMillionTokens: 3 },
        }),
        aliases: resolveModelAliases({ 'internal-opus': 'claude-opus-4-1', 'proxy-alias': 'my-proxy-model' }),
    };
    const cost = apiCost(
        [
            usage('claude-opus-4-1', 1000),
            usage('internal-opus', 1000),
            usage('proxy-alias', 1_000_000, { reportedCostUsd: 99 }),
            usage('gpt-6-sol', 1000, { speed: 'fast', reportedCostUsd: 0.5 }),
            usage('mystery-model', 1_000_000),
        ],
        pricing,
    );

    close(cost ?? NaN, 0.01 + 0.01 + 3 + 0.5);
});
