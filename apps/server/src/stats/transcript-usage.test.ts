import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';

import { assistant, claudeHome, codexHome, codexSession, codexTokens } from '../../test/stats-db.ts';
import {
    claudeSessions,
    codexSessions,
    firstCopies,
    parseClaudeLine,
    totalTokens,
    warmTranscripts,
} from './transcript-usage.ts';
import type { SessionTranscripts } from './transcript-usage.ts';
import type { UsageRecord } from './usage-record.ts';

/** A session's records, as a read of that session alone counts them. */
async function recordsOf(transcripts: SessionTranscripts, session: string): Promise<UsageRecord[]> {
    const pinned = await warmTranscripts(transcripts.files(session));

    return transcripts.records(session, pinned).flat();
}

// Ported from T3 Code's apps/server/src/provider/Drivers/claudeUsage.test.ts
// (pingdotgg/t3code main at f054d1b8018721bd997d99cbb918a7b17bf098a4).
function claudeLine(overrides: {
    messageId: string;
    contentType: string;
    model?: string;
    outputTokens?: number;
    speed?: string;
}): string {
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

test("a Claude record gives T3's token categories, model, speed and dedupe key", () => {
    const record = parseClaudeLine(claudeLine({ messageId: 'msg_1', contentType: 'text' }));

    assert.deepEqual(record, {
        provider: 'claude',
        timestampMs: Date.parse('2026-08-07T04:05:13.944Z'),
        model: 'claude-fable-5',
        sessionId: '5a128faa-8253-489e-b935-6c08e8e670c0',
        totals: {
            uncachedInputTokens: 2,
            cachedInputTokens: 1000,
            cacheCreationTokens: 66818,
            outputTokens: 286,
            reasoningTokens: 0,
        },
        reportedCostUsd: null,
        speed: 'standard',
        dedupeKey: 'msg_1:',
    });
    assert.equal(
        parseClaudeLine(claudeLine({ messageId: 'msg_1', contentType: 'text', speed: 'fast' }))?.speed,
        'fast',
    );

    const withRequest = JSON.parse(claudeLine({ messageId: 'msg_1', contentType: 'text' }));

    assert.equal(
        parseClaudeLine(JSON.stringify({ ...withRequest, requestId: 'req_1', costUSD: 0.42 }))?.dedupeKey,
        'msg_1:req_1',
    );
    assert.equal(
        parseClaudeLine(JSON.stringify({ ...withRequest, requestId: 'req_1', costUSD: 0.42 }))?.reportedCostUsd,
        0.42,
    );
});

test('every content block of one message has the same dedupe key, so its usage counts once', () => {
    const text = parseClaudeLine(claudeLine({ messageId: 'msg_2', contentType: 'text' }))!;
    const toolUse = parseClaudeLine(claudeLine({ messageId: 'msg_2', contentType: 'tool_use' }))!;

    assert.equal(text.dedupeKey, toolUse.dedupeKey);

    const keep = firstCopies();
    const kept = [text, toolUse].filter(keep);

    assert.equal(kept.length, 1);
    assert.equal(totalTokens(kept), 2 + 1000 + 66818 + 286, "T3's total for the message");
});

test("a session's records come from its own transcript and its subagents' transcripts", async (t) => {
    const home = claudeHome(t, {
        'session-a': {
            main: [
                { type: 'user', message: { role: 'user', content: 'Review the branch' } },
                assistant('msg-1', 2, 1000, 5000, 40),
            ],
            subagents: { a1: [assistant('msg-2', 1, 0, 6000, 100), '{garbled'], a2: [assistant('msg-3', 10, 0, 0, 5)] },
        },
        'session-b': { subagents: { b1: [assistant('msg-4', 3, 0, 0, 3)] } },
    });
    const read = await claudeSessions(home);

    assert.deepEqual(
        (await recordsOf(read, 'session-a')).map((r) => r.dedupeKey),
        ['msg-1:req-msg-1', 'msg-2:req-msg-2', 'msg-3:req-msg-3'],
    );
    assert.deepEqual(
        (await recordsOf(read, 'session-b')).map((r) => r.dedupeKey),
        ['msg-4:req-msg-4'],
    );
    assert.deepEqual(await recordsOf(read, 'session-none'), []);
    assert.deepEqual(await recordsOf(read, '../escape'), []);
    assert.deepEqual(await recordsOf(await claudeSessions(`${home}/missing`), 'session-a'), []);
});

test("a warm parses only what isn't cached or changed since, and pins what it read against later changes", async (t) => {
    const home = claudeHome(t, {
        'session-a': { main: [assistant('msg-1', 1, 0, 0, 1)], subagents: { a1: [assistant('msg-2', 1, 0, 0, 1)] } },
        'session-b': { main: [assistant('msg-3', 1, 0, 0, 1)] },
    });
    const read = await claudeSessions(home);
    const files = read.files('session-a');

    assert.deepEqual(
        files.map((file) => file.path.split('/').at(-1)),
        ['session-a.jsonl', 'agent-a1.jsonl'],
        'only the session asked for',
    );

    const first = await warmTranscripts(files);

    assert.equal(first.parsed, 2);
    assert.equal((await warmTranscripts(files)).parsed, 0);
    appendFileSync(files[0]!.path, JSON.stringify(assistant('msg-9', 1, 0, 0, 1)) + '\n');
    assert.deepEqual(
        read
            .records('session-a', first)
            .flat()
            .map((r) => r.dedupeKey),
        ['msg-1:req-msg-1', 'msg-2:req-msg-2'],
        'the first read stands as it was',
    );

    const changed = await warmTranscripts(files);

    assert.equal(changed.parsed, 1, 'only the changed file parses again');
    assert.deepEqual(
        read
            .records('session-a', changed)
            .flat()
            .map((r) => r.dedupeKey),
        ['msg-1:req-msg-1', 'msg-9:req-msg-9', 'msg-2:req-msg-2'],
    );
});

test("a Codex session's records come from its rollout, found by the session ID in its file name", async (t) => {
    const own = '01a13627-9790-70d0-8342-58f71022e222';
    const fork = '01a13628-c84a-7f33-9a04-c55eb4c75845';
    const home = codexHome(t, {
        [own]: [
            ...codexSession(own),
            codexTokens('2026-10-20T09:01:00.000Z', 1000, 400, 50, [1000, 400, 50]),
            '{garbled',
            codexTokens('2026-10-20T09:02:00.000Z', 2000, 1500, 70, [3000, 1900, 120]),
        ],
        // The fork copies its parent's request in the instant it opens, then makes its own.
        [fork]: [
            ...codexSession(fork, 'gpt-5.6-sol', own),
            codexTokens('2026-10-20T09:00:00.000Z', 1000, 400, 50, [1000, 400, 50]),
            codexTokens('2026-10-20T09:05:00.000Z', 300, 0, 9, [1300, 400, 59]),
        ],
    });
    const read = await codexSessions(home);

    assert.deepEqual(
        (await recordsOf(read, own)).map((r) => [r.sessionId, r.model, totalTokens([r])]),
        [
            [own, 'gpt-5.6-sol', 1050],
            [own, 'gpt-5.6-sol', 2070],
        ],
    );
    assert.deepEqual(
        (await recordsOf(read, fork)).map((r) => totalTokens([r])),
        [309],
    );
    assert.deepEqual(await recordsOf(read, '01a13629-0000-7000-8000-000000000000'), []);
    assert.deepEqual(await recordsOf(await codexSessions(join(home, 'missing')), own), []);
});
