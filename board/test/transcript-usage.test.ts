import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeSessionRecords, firstCopies, parseClaudeLine, totalTokens } from '../src/transcript-usage.ts';
import type { UsageRecord } from '../src/transcript-usage.ts';
import { assistant, claudeHome } from './stats-db.ts';

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
