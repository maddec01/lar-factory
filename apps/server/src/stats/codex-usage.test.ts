import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { initialCodexScanState, parseCodexLine } from './codex-usage.ts';
import { totalTokens } from './transcript-usage.ts';

// Ported from T3 Code's apps/server/src/provider/Drivers/codexUsage.test.ts
// (pingdotgg/t3code main at f054d1b8018721bd997d99cbb918a7b17bf098a4).
const sessionMeta = JSON.stringify({
    type: 'session_meta',
    timestamp: '2026-08-01T05:17:41.289Z',
    payload: { type: 'session_meta', id: '019fbbc1-b12c-7360-a685-28c181f0025f' },
});
const turnContext = JSON.stringify({
    type: 'turn_context',
    timestamp: '2026-08-01T05:17:42.694Z',
    payload: { type: 'turn_context', model: 'gpt-5.6-sol' },
});
const tokenCount = (inputTokens: number, cached: number, output: number, reasoning: number) =>
    JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-08-01T05:17:49.919Z',
        payload: {
            type: 'token_count',
            info: {
                last_token_usage: {
                    input_tokens: inputTokens,
                    cached_input_tokens: cached,
                    cache_write_input_tokens: 0,
                    output_tokens: output,
                    reasoning_output_tokens: reasoning,
                },
            },
        },
    });
const counters = (input: number, output: number) => ({
    input_tokens: input,
    cached_input_tokens: 0,
    cache_write_input_tokens: 0,
    output_tokens: output,
    reasoning_output_tokens: 0,
    total_tokens: input + output,
});
const counted = (last: unknown, total?: unknown, extra = {}) =>
    JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-08-01T05:17:49.919Z',
        payload: { type: 'token_count', info: { last_token_usage: last, total_token_usage: total, ...extra } },
    });

test('a Codex record takes its model from the preceding turn context, and input includes the cached part', () => {
    const state = initialCodexScanState();

    parseCodexLine(sessionMeta, state);
    parseCodexLine(turnContext, state);

    const record = parseCodexLine(tokenCount(19239, 11008, 299, 116), state);

    assert.deepEqual(record, {
        provider: 'codex',
        timestampMs: Date.parse('2026-08-01T05:17:49.919Z'),
        model: 'gpt-5.6-sol',
        sessionId: '019fbbc1-b12c-7360-a685-28c181f0025f',
        totals: {
            uncachedInputTokens: 19239 - 11008,
            cachedInputTokens: 11008,
            cacheCreationTokens: 0,
            outputTokens: 299,
            reasoningTokens: 116,
        },
        reportedCostUsd: null,
        speed: 'standard',
        dedupeKey: null,
    });
    assert.equal(totalTokens([record!]), 19239 + 299, "T3's total: reasoning is inside output");
});

test('a repeated Codex token_count is skipped, so deltas are not counted twice', () => {
    const state = initialCodexScanState();

    parseCodexLine(turnContext, state);
    assert.notEqual(parseCodexLine(tokenCount(100, 0, 10, 0), state), null);
    assert.equal(parseCodexLine(tokenCount(100, 0, 10, 0), state), null);
});

test('stale Codex requests are ignored, equal requests count when totals advance, and the tier follows thread settings', () => {
    const state = initialCodexScanState();

    parseCodexLine(turnContext, state);

    const request = counters(100, 20);

    assert.equal(parseCodexLine(counted(request, request), state)?.totals.outputTokens, 20);
    assert.equal(parseCodexLine(counted(counters(20, 5), request), state), null);
    assert.equal(
        parseCodexLine(
            counted({ ...counters(0, 0), total_tokens: 20330 }, request, { model_context_window: 258400 }),
            state,
        ),
        null,
    );
    assert.equal(parseCodexLine(counted(request, counters(200, 40)), state)?.totals.outputTokens, 20);
    for (const [index, tier] of ['priority', 'ultrafast'].entries()) {
        parseCodexLine(JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-astra' } }), state);
        parseCodexLine(
            JSON.stringify({
                type: 'event_msg',
                payload: { type: 'thread_settings_applied', thread_settings: { service_tier: tier } },
            }),
            state,
        );

        const record = parseCodexLine(counted(request, counters(100 * (index + 3), 20 * (index + 3))), state);

        assert.equal(record?.model, 'gpt-6-astra');
        assert.equal(record?.speed, tier === 'priority' ? 'fast' : 'ultrafast');
        assert.equal(record?.totals.uncachedInputTokens, 100);
        assert.equal(record?.totals.outputTokens, 20);
    }
    assert.equal(state.malformedRecords, 0);
});

// A forked or subagent rollout opens with the parent's history copied in and every
// line re-stamped to the fork instant, then the ancestors' session metas.
const forkMeta = (overrides: { id: string; timestamp: string; forkedFromId?: string; spawnParentId?: string }) =>
    JSON.stringify({
        type: 'session_meta',
        timestamp: overrides.timestamp,
        payload: {
            type: 'session_meta',
            id: overrides.id,
            ...(overrides.forkedFromId === undefined ? {} : { forked_from_id: overrides.forkedFromId }),
            ...(overrides.spawnParentId === undefined
                ? {}
                : { source: { subagent: { thread_spawn: { parent_thread_id: overrides.spawnParentId } } } }),
        },
    });
const stamped = (timestamp: string, line: string) => JSON.stringify({ ...JSON.parse(line), timestamp });

test('a forked Codex rollout drops its re-stamped copied burst and keeps its own first event', () => {
    const state = initialCodexScanState();
    const forkInstant = '2026-08-01T05:00:00.000Z';

    parseCodexLine(forkMeta({ id: 'child', timestamp: forkInstant, forkedFromId: 'parent' }), state);
    parseCodexLine(forkMeta({ id: 'parent', timestamp: forkInstant }), state);
    parseCodexLine(stamped(forkInstant, turnContext), state);
    assert.equal(
        parseCodexLine(stamped('2026-08-01T05:00:00.001Z', counted(counters(100, 10), counters(100, 10))), state),
        null,
    );
    assert.equal(
        parseCodexLine(stamped('2026-08-01T05:00:00.002Z', counted(counters(200, 20), counters(300, 30))), state),
        null,
    );

    const real = parseCodexLine(
        stamped('2026-08-01T05:00:06.000Z', counted(counters(200, 20), counters(500, 50))),
        state,
    );

    assert.equal(real?.sessionId, 'child');
    assert.equal(real?.totals.outputTokens, 20);
    assert.notEqual(
        parseCodexLine(stamped('2026-08-01T05:00:06.100Z', counted(counters(400, 40), counters(900, 90))), state),
        null,
    );
    assert.equal(state.malformedRecords, 0);

    const spawned = initialCodexScanState();

    parseCodexLine(forkMeta({ id: 'child', timestamp: forkInstant, spawnParentId: 'parent' }), spawned);
    parseCodexLine(stamped(forkInstant, turnContext), spawned);
    assert.equal(
        parseCodexLine(stamped('2026-08-01T05:00:00.001Z', tokenCount(100, 0, 10, 0)), spawned),
        null,
        'a subagent spawn is a fork too',
    );

    const root = initialCodexScanState();

    parseCodexLine(forkMeta({ id: 'root', timestamp: '2026-08-01T05:00:00.000Z' }), root);
    parseCodexLine(stamped('2026-08-01T05:00:00.100Z', turnContext), root);
    assert.notEqual(
        parseCodexLine(stamped('2026-08-01T05:00:00.200Z', tokenCount(100, 0, 10, 0)), root),
        null,
        'a rollout that is no fork drops nothing',
    );
});
