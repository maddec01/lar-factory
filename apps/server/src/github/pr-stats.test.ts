import type { Item, ItemStats, LinkedPr } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { mergedStats, prStatsEdits, statsBlock, updatedBody, withStatsBlock } from './pr-stats.ts';

const stats: ItemStats = { agentMs: 65 * 60_000, wallMs: 47 * 60_000, tokens: 12_436_000, costUsd: 41.2 };
const block = statsBlock(stats);

test('the block shows agent time, wall time, total tokens and API cost, between markers', () => {
    assert.equal(
        block,
        '<!-- lar-stats -->\n**Item stats** (kept current by the lar board): Σ 1h 5m · wall 47m · 12.4M · $41\n<!-- lar-stats-data {"agentMs":3900000,"wallMs":2820000,"tokens":12436000,"costUsd":41.2} -->\n<!-- /lar-stats -->',
    );
    assert.equal(
        statsBlock({ agentMs: 195 * 60_000, wallMs: 75 * 60_000, tokens: 980 }),
        '<!-- lar-stats -->\n**Item stats** (kept current by the lar board): Σ 3h 15m · wall 1h 15m · 980\n<!-- lar-stats-data {"agentMs":11700000,"wallMs":4500000,"tokens":980} -->\n<!-- /lar-stats -->',
        'nothing priced, no cost',
    );
    assert.equal(
        statsBlock({ agentMs: stats.agentMs, tokens: 980 }),
        '<!-- lar-stats -->\n**Item stats** (kept current by the lar board): Σ 1h 5m · 980\n<!-- lar-stats-data {"agentMs":3900000,"tokens":980} -->\n<!-- /lar-stats -->',
        'no wall time, no wall part',
    );
});

test('a body with a block gets only the block replaced', () => {
    const before = 'Intro\r\n\r\n';
    const after = '\r\n\r\n## Verify\r\nSteps <!-- lar-stats --> quoted later';
    const body = `${before}<!-- lar-stats -->\nold numbers\n<!-- /lar-stats -->${after}`;

    assert.equal(withStatsBlock(body, block), `${before}${block}${after}`);
    assert.equal(
        withStatsBlock(withStatsBlock(body, block), block),
        `${before}${block}${after}`,
        'the same stats leave the body as it is',
    );
});

const pr = (number: number, state: LinkedPr['state'], body: string | undefined, mergedAt?: string): LinkedPr => ({
    number,
    url: `https://github.com/maddec01/lar-factory/pull/${number}`,
    state,
    isDraft: false,
    checks: null,
    mergeState: 'can merge',
    body,
    mergedAt,
});
const edits = (items: Item[]) => prStatsEdits(items);
const item = (
    linkedPrs: LinkedPr[],
    itemStats: Item['stats'] | null = stats,
    labels = ['build'],
    repo = 'maddec01/lar-factory',
) => ({ linkedPrs, stats: itemStats ?? undefined, labels, repo }) as Item;

test('a merged build refreshes an outdated block before freezing and retains its exact final figures', () => {
    const final = { agentMs: 167_550, wallMs: 167_550, tokens: 12_345, costUsd: 0.27 };
    const build = item([pr(1, 'merged', statsBlock({ agentMs: 0, wallMs: 0, tokens: 0 }))], final);

    assert.deepEqual(mergedStats(build, final), { ...final, frozen: true });

    const [edit] = edits([{ ...build, stats: mergedStats(build, final)! }]);

    assert.ok(edit, 'persist the final figures in the merged PR');
    assert.deepEqual(mergedStats(item([pr(1, 'merged', edit.body)], null)), { ...final, frozen: true });
});

test('a stale stats read never lowers known final figures, including when the PR body changed after the board read it', () => {
    const known: ItemStats = { agentMs: 167_550, wallMs: 160_000, tokens: 12_345, costUsd: 0.27, frozen: true };
    const stale = { agentMs: 0, wallMs: 0, tokens: 0 };
    const body = `Latest description\n\n${statsBlock(known)}`;

    assert.deepEqual(mergedStats(item([pr(1, 'merged', body)], known), stale), known);
    assert.deepEqual(edits([item([pr(1, 'merged', body)], { ...stale, frozen: true })]), []);
    assert.equal(updatedBody(body, statsBlock({ ...stale, frozen: true })), null);
});

test('edits refresh open and merged PRs whose block is missing or out of date, leaving closed ones alone', () => {
    const current = `Body\n\n${block}`;

    assert.deepEqual(
        edits([
            item([pr(1, 'open', 'Body'), pr(2, 'merged', 'Body'), pr(3, 'closed', 'Body'), pr(4, 'open', current)]),
        ]),
        [{ url: pr(1, 'open', '').url, final: false, block, body: current }],
    );
    assert.deepEqual(
        edits([item([pr(5, 'open', current.replaceAll('\n', '\r\n'))])]),
        [],
        'a block GitHub sent back with CRLF line ends is still current',
    );

    const stale = `Body\n\n${statsBlock({ ...stats, agentMs: 0 })}`;

    assert.deepEqual(edits([item([pr(6, 'open', stale)])]), [
        { url: pr(6, 'open', '').url, final: false, block, body: current },
    ]);
});

test('PRs in a repo with no items on the board are left alone; any repo with items gets its blocks', () => {
    const elsewhere = { ...pr(7, 'open', 'Body'), url: 'https://github.com/someone/other/pull/7' };
    const prefix = { ...pr(8, 'open', 'Body'), url: 'https://github.com/maddec01/lar-factory-fork/pull/8' };
    const app = { ...pr(10, 'open', 'Body'), url: 'https://github.com/maddec01/lar-app/pull/10' };

    assert.deepEqual(
        edits([
            item([elsewhere, prefix, pr(9, 'open', 'Body')]),
            item([app], stats, ['build'], 'maddec01/lar-app'),
        ]).map((e) => e.url),
        [pr(9, 'open', '').url, app.url],
    );
    assert.deepEqual(
        edits([item([app]), item([], null, [], 'maddec01/lar-app')]).map((e) => e.url),
        [app.url],
        'an item without stats still puts its repo on the board',
    );
});

test('a merged item reads a block in the old format, from before wall time, with no wall time', () => {
    const old = (figures: string) =>
        mergedStats(
            item(
                [
                    pr(
                        1,
                        'merged',
                        `Body\n\n<!-- lar-stats -->\n**Item stats** (kept current by the lar board): ${figures}\n<!-- /lar-stats -->`,
                    ),
                ],
                null,
            ),
        );

    assert.deepEqual(old('agent time 3h 15m · 12.4M tokens · $41'), {
        agentMs: 195 * 60_000,
        tokens: 12_400_000,
        costUsd: 41,
        frozen: true,
    });
    assert.deepEqual(
        old('agent time 5m · 980 tokens'),
        { agentMs: 5 * 60_000, tokens: 980, frozen: true },
        'nothing priced, no cost',
    );
});
