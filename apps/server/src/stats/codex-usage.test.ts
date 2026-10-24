import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
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
const tokenCount = (inputTokens: number, cached: number, output: number, reasoning: number) => JSON.stringify({
  type: 'event_msg',
  timestamp: '2026-08-01T05:17:49.919Z',
  payload: { type: 'token_count', info: { last_token_usage: {
    input_tokens: inputTokens, cached_input_tokens: cached, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: reasoning,
  } } },
});
const counters = (input: number, output: number) => ({
  input_tokens: input, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output,
});
const counted = (last: unknown, total?: unknown, extra = {}) => JSON.stringify({
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
    totals: { uncachedInputTokens: 19239 - 11008, cachedInputTokens: 11008, cacheCreationTokens: 0, outputTokens: 299, reasoningTokens: 116 },
    reportedCostUsd: null,
    speed: 'standard',
    dedupeKey: null,
  });
  assert.equal(totalTokens([record!]), 19239 + 299, 'T3\'s total: reasoning is inside output');
});

test('a repeated Codex token_count is skipped, so deltas are not counted twice', () => {
  const state = initialCodexScanState();
  parseCodexLine(turnContext, state);
  assert.notEqual(parseCodexLine(tokenCount(100, 0, 10, 0), state), null);
  assert.equal(parseCodexLine(tokenCount(100, 0, 10, 0), state), null);
});

test('Codex counters before a model or a valid timestamp are dropped, not consumed', () => {
  const state = initialCodexScanState();
  assert.equal(parseCodexLine(tokenCount(100, 0, 10, 0), state), null);
  parseCodexLine(turnContext, state);
  assert.notEqual(parseCodexLine(tokenCount(100, 0, 10, 0), state), null);

  const cumulativeState = initialCodexScanState();
  const line = counted(counters(100, 20), counters(100, 20));
  assert.equal(parseCodexLine(line, cumulativeState), null);
  parseCodexLine(turnContext, cumulativeState);
  assert.equal(parseCodexLine(line.replace('2026-08-01T05:17:49.919Z', 'invalid'), cumulativeState), null);
  assert.equal(parseCodexLine(line, cumulativeState)?.totals.outputTokens, 20);
  assert.equal(cumulativeState.malformedRecords, 0);
});

test('stale Codex requests are ignored, equal requests count when totals advance, and the tier follows thread settings', () => {
  const state = initialCodexScanState();
  parseCodexLine(turnContext, state);
  const request = counters(100, 20);
  assert.equal(parseCodexLine(counted(request, request), state)?.totals.outputTokens, 20);
  assert.equal(parseCodexLine(counted(counters(20, 5), request), state), null);
  assert.equal(parseCodexLine(counted({ ...counters(0, 0), total_tokens: 20330 }, request, { model_context_window: 258400 }), state), null);
  assert.equal(parseCodexLine(counted(request, counters(200, 40)), state)?.totals.outputTokens, 20);
  for (const [index, tier] of ['priority', 'ultrafast'].entries()) {
    parseCodexLine(JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-astra' } }), state);
    parseCodexLine(JSON.stringify({ type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { service_tier: tier } } }), state);
    const record = parseCodexLine(counted(request, counters(100 * (index + 3), 20 * (index + 3))), state);
    assert.equal(record?.model, 'gpt-6-astra');
    assert.equal(record?.speed, tier === 'priority' ? 'fast' : 'ultrafast');
    assert.equal(record?.totals.uncachedInputTokens, 100);
    assert.equal(record?.totals.outputTokens, 20);
  }
  assert.equal(state.malformedRecords, 0);
});

for (const initialCumulative of [false, true]) {
  test(`legacy Codex requests are not billed again, nor the next cumulative delta dropped (initial cumulative=${initialCumulative})`, () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    const first = counters(100, 20);
    assert.equal(parseCodexLine(counted(first, initialCumulative ? first : undefined), state)?.totals.outputTokens, 20);
    assert.equal(parseCodexLine(counted(first), state), null);
    assert.equal(parseCodexLine(counted(counters(20, 5)), state)?.totals.outputTokens, 5);
    assert.equal(parseCodexLine(counted(counters(20, 5), counters(120, 25)), state), null);
    assert.equal(parseCodexLine(counted(counters(10, 2), counters(130, 27)), state)?.totals.outputTokens, 2);
    assert.equal(state.malformedRecords, 0);
  });
}

test('every cumulative Codex component is checked, and an inconsistent pair still sets the baseline', () => {
  const request = { ...counters(100, 20), cached_input_tokens: 30, cache_write_input_tokens: 10, reasoning_output_tokens: 5 };
  const fields = Object.keys(request) as (keyof typeof request)[];
  for (const field of fields) {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    assert.deepEqual(parseCodexLine(counted(request, request), state)?.totals,
      { uncachedInputTokens: 60, cachedInputTokens: 30, cacheCreationTokens: 10, outputTokens: 20, reasoningTokens: 5 });
    const total = { ...request };
    for (const key of fields) total[key] *= 2;
    total[field] += 1;
    if (field === 'input_tokens' || field === 'output_tokens') total.total_tokens += 1;
    assert.equal(parseCodexLine(counted(request, total), state), null, field);
    assert.equal(state.malformedRecords, 1, field);
    for (const key of fields) total[key] += request[key];
    assert.equal(parseCodexLine(counted(request, total), state)?.totals.outputTokens, 20, field);
    assert.equal(state.malformedRecords, 1, field);
  }
});

for (const malformed of ['request', 'cumulative']) {
  test(`malformed Codex ${malformed} counters are skipped, and the next request counts`, () => {
    const state = initialCodexScanState();
    parseCodexLine(turnContext, state);
    const request = counters(100, 20);
    parseCodexLine(counted(request, request), state);
    assert.equal(parseCodexLine(counted(
      malformed === 'request' ? { ...request, cached_input_tokens: -1 } : request,
      malformed === 'cumulative' ? { ...counters(200, 40), output_tokens: '40' } : counters(200, 40),
    ), state), null);
    assert.equal(state.malformedRecords, 1);
    assert.equal(parseCodexLine(counted(request, malformed === 'request' ? counters(300, 60) : counters(200, 40)), state)?.totals.outputTokens, 20);
    assert.equal(state.malformedRecords, 1);
  });
}

test('a Codex context-window estimate or compaction marker is not billed, and the next request counts', () => {
  const state = initialCodexScanState();
  parseCodexLine(turnContext, state);
  parseCodexLine(counted(counters(100, 20), counters(100, 20)), state);
  const estimate = { ...counters(0, 0), total_tokens: 1000 };
  assert.equal(parseCodexLine(counted({ ...estimate, total_tokens: 880 }, estimate, { model_context_window: 1000 }), state), null);
  assert.equal(parseCodexLine(counted(counters(10, 2), { ...counters(10, 2), total_tokens: 1012 }), state)?.totals.outputTokens, 2);
  const marker = counted({ ...counters(0, 0), total_tokens: 26387 }, counters(0, 0), { model_context_window: 475000 });
  assert.equal(parseCodexLine(marker, state), null);
  // After a compaction or a resume in a new process, the cumulative counters restart at the request.
  assert.equal(parseCodexLine(counted(counters(30, 5), counters(30, 5)), state)?.totals.outputTokens, 5);
  assert.equal(parseCodexLine(counted(counters(10, 2), counters(40, 7)), state)?.totals.outputTokens, 2);
  assert.equal(state.malformedRecords, 0);
});

test('a Codex OpenAI session\'s turn keeps its tier unresolved until thread settings arrive', () => {
  const meta = (id: string, model_provider?: string) => JSON.stringify({ type: 'session_meta', payload: { id, model_provider } });
  const context = (turn_id?: string, model?: string) => JSON.stringify({ type: 'turn_context', payload: { turn_id, model } });
  for (const provider of ['openai', 'custom', undefined]) {
    const state = initialCodexScanState();
    parseCodexLine(meta('own-session', provider), state);
    parseCodexLine(meta('ancestor', provider === 'openai' ? 'custom' : 'openai'), state);
    parseCodexLine(context('first-turn', 'gpt-6-astra'), state);
    const first = parseCodexLine(tokenCount(100, 0, 1, 0), state);
    assert.equal(first?.sessionId, 'own-session');
    assert.equal(first?.unresolvedServiceTierTurnId, provider === 'openai' ? 'first-turn' : undefined);
  }
  const state = initialCodexScanState();
  parseCodexLine(meta('own-session', 'openai'), state);
  parseCodexLine(JSON.stringify({ type: 'event_msg', payload: { type: 'thread_settings_applied', thread_settings: { service_tier: 'priority' } } }), state);
  parseCodexLine(context('native-turn', 'gpt-6-astra'), state);
  const record = parseCodexLine(tokenCount(100, 0, 2, 0), state);
  assert.equal(record?.speed, 'fast');
  assert.equal(record && 'unresolvedServiceTierTurnId' in record, false);
});

// A forked or subagent rollout opens with the parent's history copied in and every
// line re-stamped to the fork instant, then the ancestors' session metas.
const forkMeta = (overrides: { id: string; timestamp: string; forkedFromId?: string; spawnParentId?: string }) => JSON.stringify({
  type: 'session_meta',
  timestamp: overrides.timestamp,
  payload: {
    type: 'session_meta',
    id: overrides.id,
    ...(overrides.forkedFromId === undefined ? {} : { forked_from_id: overrides.forkedFromId }),
    ...(overrides.spawnParentId === undefined ? {} : { source: { subagent: { thread_spawn: { parent_thread_id: overrides.spawnParentId } } } }),
  },
});
const stamped = (timestamp: string, line: string) => JSON.stringify({ ...JSON.parse(line), timestamp });

test('a forked Codex rollout drops its re-stamped copied burst and keeps its own first event', () => {
  const state = initialCodexScanState();
  const forkInstant = '2026-08-01T05:00:00.000Z';
  parseCodexLine(forkMeta({ id: 'child', timestamp: forkInstant, forkedFromId: 'parent' }), state);
  parseCodexLine(forkMeta({ id: 'parent', timestamp: forkInstant }), state);
  parseCodexLine(stamped(forkInstant, turnContext), state);
  assert.equal(parseCodexLine(stamped('2026-08-01T05:00:00.001Z', counted(counters(100, 10), counters(100, 10))), state), null);
  assert.equal(parseCodexLine(stamped('2026-08-01T05:00:00.002Z', counted(counters(200, 20), counters(300, 30))), state), null);
  const real = parseCodexLine(stamped('2026-08-01T05:00:06.000Z', counted(counters(200, 20), counters(500, 50))), state);
  assert.equal(real?.sessionId, 'child');
  assert.equal(real?.totals.outputTokens, 20);
  assert.notEqual(parseCodexLine(stamped('2026-08-01T05:00:06.100Z', counted(counters(400, 40), counters(900, 90))), state), null);
  assert.equal(state.malformedRecords, 0);

  const spawned = initialCodexScanState();
  parseCodexLine(forkMeta({ id: 'child', timestamp: forkInstant, spawnParentId: 'parent' }), spawned);
  parseCodexLine(stamped(forkInstant, turnContext), spawned);
  assert.equal(parseCodexLine(stamped('2026-08-01T05:00:00.001Z', tokenCount(100, 0, 10, 0)), spawned), null, 'a subagent spawn is a fork too');

  const root = initialCodexScanState();
  parseCodexLine(forkMeta({ id: 'root', timestamp: '2026-08-01T05:00:00.000Z' }), root);
  parseCodexLine(stamped('2026-08-01T05:00:00.100Z', turnContext), root);
  assert.notEqual(parseCodexLine(stamped('2026-08-01T05:00:00.200Z', tokenCount(100, 0, 10, 0)), root), null, 'a rollout that is no fork drops nothing');
});
