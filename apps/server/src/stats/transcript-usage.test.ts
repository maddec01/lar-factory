import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { renameSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  claudeSessionRecords, codexSessionRecords, firstCopies, parseClaudeLine, scanTranscripts, totalTokens,
} from './transcript-usage.ts';
import type { UsageRecord } from './usage-record.ts';
import { assistant, claudeHome, codexHome, codexSession, codexTokens } from '../../test/stats-db.ts';

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
  const path = join(home, 'projects', '-Users-pedro--t3-worktrees-lar-factory-feat-60', 'session-a.jsonl');
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
