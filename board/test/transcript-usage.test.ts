import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renameSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  claudeSessionRecords, codexSessionRecords, firstCopies, initialCodexScanState, parseClaudeLine, parseCodexLine, scanTranscripts, totalTokens,
} from '../src/transcript-usage.ts';
import type { UsageRecord } from '../src/transcript-usage.ts';
import { assistant, claudeHome, codexHome, codexSession, codexTokens } from './stats-db.ts';

// Ported from T3 Code's apps/server/src/provider/Drivers/claudeUsage.test.ts
// (pingdotgg/t3code main at f054d1b8018721bd997d99cbb918a7b17bf098a4).
function claudeLine(overrides: { messageId: string; contentType: string; model?: string; outputTokens?: number; speed?: string }): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-07T04:05:13.944Z',
    sessionId: '5a128faa-8253-489e-b935-6c08e8e670c0',
    cwd: '/home/theo/project',
    message: {
      id: overrides.messageId,
      role: 'assistant',
      model: overrides.model ?? 'claude-fable-5',
      content: [{ type: overrides.contentType }],
      usage: {
        input_tokens: 2,
        cache_creation_input_tokens: 66818,
        cache_read_input_tokens: 1000,
        output_tokens: overrides.outputTokens ?? 286,
        ...(overrides.speed === undefined ? {} : { speed: overrides.speed }),
      },
    },
  });
}

test('a Claude record gives T3\'s token categories, model, speed and dedupe key', () => {
  const record = parseClaudeLine(claudeLine({ messageId: 'msg_1', contentType: 'text' }));
  assert.deepEqual(record, {
    provider: 'claude',
    timestampMs: Date.parse('2026-08-07T04:05:13.944Z'),
    model: 'claude-fable-5',
    sessionId: '5a128faa-8253-489e-b935-6c08e8e670c0',
    totals: { uncachedInputTokens: 2, cachedInputTokens: 1000, cacheCreationTokens: 66818, outputTokens: 286, reasoningTokens: 0 },
    reportedCostUsd: null,
    speed: 'standard',
    dedupeKey: 'msg_1:',
  });
  assert.equal(parseClaudeLine(claudeLine({ messageId: 'msg_1', contentType: 'text', speed: 'fast' }))?.speed, 'fast');
  const withRequest = JSON.parse(claudeLine({ messageId: 'msg_1', contentType: 'text' }));
  assert.equal(parseClaudeLine(JSON.stringify({ ...withRequest, requestId: 'req_1', costUSD: 0.42 }))?.dedupeKey, 'msg_1:req_1');
  assert.equal(parseClaudeLine(JSON.stringify({ ...withRequest, requestId: 'req_1', costUSD: 0.42 }))?.reportedCostUsd, 0.42);
});

test('every content block of one message has the same dedupe key, so its usage counts once', () => {
  const text = parseClaudeLine(claudeLine({ messageId: 'msg_2', contentType: 'text' }))!;
  const toolUse = parseClaudeLine(claudeLine({ messageId: 'msg_2', contentType: 'tool_use' }))!;
  assert.equal(text.dedupeKey, toolUse.dedupeKey);
  const keep = firstCopies();
  const kept = [text, toolUse].filter(keep);
  assert.equal(kept.length, 1);
  assert.equal(totalTokens(kept), 2 + 1000 + 66818 + 286, 'T3\'s total for the message');
});

test('placeholders, model-less and undated records are dropped; real zero-token responses are kept', () => {
  const projected = { type: 'assistant', timestamp: '2026-08-07T04:05:13.944Z', message: { model: 'claude-fable-5', usage: { input_tokens: 0, output_tokens: 0 } } };
  assert.deepEqual(parseClaudeLine(JSON.stringify(projected))?.totals,
    { uncachedInputTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 0, reasoningTokens: 0 });
  assert.equal(parseClaudeLine(JSON.stringify(projected))?.dedupeKey, null);
  assert.equal(parseClaudeLine(JSON.stringify({ ...projected, message: { ...projected.message, model: '<synthetic>' } })), null);
  assert.equal(parseClaudeLine(JSON.stringify({ ...projected, message: { usage: projected.message.usage } })), null);
  assert.equal(parseClaudeLine(JSON.stringify({ ...projected, timestamp: undefined })), null);
  assert.equal(parseClaudeLine(JSON.stringify({ ...projected, type: 'user' })), null);
  for (const garbled of ['{not json', '"a string"', 'null', '']) assert.equal(parseClaudeLine(garbled), null);
});

test('token counts take T3\'s reading: negative, fractional or non-numeric counts', () => {
  const line = JSON.stringify({ type: 'assistant', timestamp: '2026-08-07T04:05:13Z', message: { model: 'm', usage: {
    input_tokens: -5, cache_read_input_tokens: 10.9, cache_creation_input_tokens: '7', output_tokens: Infinity } } });
  assert.deepEqual(parseClaudeLine(line)?.totals,
    { uncachedInputTokens: 0, cachedInputTokens: 10, cacheCreationTokens: 0, outputTokens: 0, reasoningTokens: 0 });
});

test('total tokens leave reasoning out, since it is inside output', () => {
  const record = { totals: { uncachedInputTokens: 1, cachedInputTokens: 2, cacheCreationTokens: 3, outputTokens: 40, reasoningTokens: 30 } } as UsageRecord;
  assert.equal(totalTokens([record, record]), 92);
  assert.equal(totalTokens([]), 0);
});

test('a session\'s records come from its own transcript and its subagents\' transcripts', (t) => {
  const home = claudeHome(t, {
    'session-a': {
      main: [{ type: 'user', message: { role: 'user', content: 'Review the branch' } }, assistant('msg-1', 2, 1000, 5000, 40)],
      subagents: { a1: [assistant('msg-2', 1, 0, 6000, 100), '{garbled'], a2: [assistant('msg-3', 10, 0, 0, 5)] },
    },
    'session-b': { subagents: { b1: [assistant('msg-4', 3, 0, 0, 3)] } },
  });
  const read = claudeSessionRecords(home);
  assert.deepEqual(read('session-a').map((r) => r.dedupeKey), ['msg-1:req-msg-1', 'msg-2:req-msg-2', 'msg-3:req-msg-3']);
  assert.deepEqual(read('session-b').map((r) => r.dedupeKey), ['msg-4:req-msg-4']);
  assert.deepEqual(read('session-none'), []);
  assert.deepEqual(read('../escape'), []);
  assert.deepEqual(claudeSessionRecords(`${home}/missing`)('session-a'), []);
});

test('a scan drops the cached records of transcripts it no longer reads, so the cache doesn\'t keep deleted files', (t) => {
  const home = claudeHome(t, { 'session-a': { main: [assistant('msg-1', 1, 0, 0, 1)] } });
  const path = join(home, 'projects', '-Users-pedro--t3-worktrees-mux-factory-feat-60', 'session-a.jsonl');
  const ids = () => scanTranscripts(() => claudeSessionRecords(home)('session-a')).map((r) => r.dedupeKey);
  const at = 1_760_000_000;
  utimesSync(path, at, at);
  assert.deepEqual(ids(), ['msg-1:req-msg-1']);
  const { size } = statSync(path);
  renameSync(path, `${path}.gone`);
  assert.deepEqual(ids(), []);
  // The same name, time and size again, but other records: only a dropped entry reads them.
  writeFileSync(path, JSON.stringify(assistant('msg-2', 1, 0, 0, 1)) + '\n');
  utimesSync(path, at, at);
  assert.equal(statSync(path).size, size);
  assert.deepEqual(ids(), ['msg-2:req-msg-2']);
});

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

test('a Codex session\'s records come from its rollout, found by the session ID in its file name', (t) => {
  const own = '01a13627-9790-70d0-8342-58f71022e222';
  const fork = '01a13628-c84a-7f33-9a04-c55eb4c75845';
  const home = codexHome(t, {
    [own]: [...codexSession(own), codexTokens('2026-10-20T09:01:00.000Z', 1000, 400, 50, [1000, 400, 50]), '{garbled',
      codexTokens('2026-10-20T09:02:00.000Z', 2000, 1500, 70, [3000, 1900, 120])],
    // The fork copies its parent's request in the instant it opens, then makes its own.
    [fork]: [...codexSession(fork, 'gpt-5.6-sol', own), codexTokens('2026-10-20T09:00:00.000Z', 1000, 400, 50, [1000, 400, 50]),
      codexTokens('2026-10-20T09:05:00.000Z', 300, 0, 9, [1300, 400, 59])],
  });
  const read = codexSessionRecords(home);
  assert.deepEqual(read(own).map((r) => [r.sessionId, r.model, totalTokens([r])]), [[own, 'gpt-5.6-sol', 1050], [own, 'gpt-5.6-sol', 2070]]);
  assert.deepEqual(read(fork).map((r) => totalTokens([r])), [309]);
  assert.deepEqual(read('01a13629-0000-7000-8000-000000000000'), []);
  assert.deepEqual(codexSessionRecords(join(home, 'missing'))(own), []);
});

test('a Codex session copied into a second rollout counts once, as T3 keys sessions found in several files', (t) => {
  const id = '01a13627-9790-70d0-8342-58f71022e222';
  const lines = [...codexSession(id), codexTokens('2026-10-20T09:01:00.000Z', 100, 0, 5), codexTokens('2026-10-20T09:01:00.000Z', 200, 0, 5)];
  const home = codexHome(t, { [id]: lines });
  writeFileSync(join(home, 'sessions', '2026', '10', '20', `rollout-2026-10-20T10-00-00-${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n'));
  const records = codexSessionRecords(home)(id);
  assert.equal(records.length, 4);
  assert.equal(totalTokens(records.filter(firstCopies())), 105 + 205);
});
