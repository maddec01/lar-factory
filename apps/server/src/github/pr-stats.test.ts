import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mergedStats, prStatsEdits, statsBlock, updatedBody, withStatsBlock } from './pr-stats.ts';
import type { Item, ItemStats, LinkedPr } from '@lar-factory/shared';

const stats: ItemStats = { agentMs: 65 * 60_000, wallMs: 47 * 60_000, tokens: 12_436_000, costUsd: 41.2 };
const block = statsBlock(stats);

test('the block shows agent time, wall time, total tokens and API cost, between markers', () => {
  assert.equal(block, '<!-- lar-stats -->\n**Item stats** (kept current by the lar board): Σ 1h 5m · wall 47m · 12.4M · $41\n<!-- lar-stats-data {"agentMs":3900000,"wallMs":2820000,"tokens":12436000,"costUsd":41.2} -->\n<!-- /lar-stats -->');
  assert.equal(statsBlock({ agentMs: 195 * 60_000, wallMs: 75 * 60_000, tokens: 980 }),
    '<!-- lar-stats -->\n**Item stats** (kept current by the lar board): Σ 3h 15m · wall 1h 15m · 980\n<!-- lar-stats-data {"agentMs":11700000,"wallMs":4500000,"tokens":980} -->\n<!-- /lar-stats -->', 'nothing priced, no cost');
  assert.equal(statsBlock({ agentMs: stats.agentMs, tokens: 980 }),
    '<!-- lar-stats -->\n**Item stats** (kept current by the lar board): Σ 1h 5m · 980\n<!-- lar-stats-data {"agentMs":3900000,"tokens":980} -->\n<!-- /lar-stats -->', 'no wall time, no wall part');
});

test('the block displays whole dollars and preserves cents in its data', () => {
  const cost = (costUsd: number) => / · ([^ ·]+)\n/.exec(statsBlock({ ...stats, costUsd }))?.[1];
  assert.deepEqual([0, 0.004, 0.99, 1, 1.49, 1.5, 41.2, 1234.5].map(cost), ['<$1', '<$1', '<$1', '$1', '$1', '$2', '$41', '$1,235']);
  assert.equal(edits([item([pr(1, 'open', `Body\n\n${block}`)], { ...stats, costUsd: 41.4 })]).length, 1, 'the data retains cents; the server throttles running edits');
});

test('PR times use minute precision and keep every positive short duration visible', () => {
  const shown = (ms: number) => /Σ (.+) · 12.4M/.exec(statsBlock({ ...stats, agentMs: ms, wallMs: ms }))?.[1];
  assert.deepEqual([0, 1, 24_000, 59_999, 60_000, 138_072, 3_599_999, 4_056_000].map(shown), [
    '0m · wall 0m', '<1m · wall <1m', '<1m · wall <1m', '<1m · wall <1m',
    '1m · wall 1m', '2m · wall 2m', '59m · wall 59m', '1h 7m · wall 1h 7m',
  ]);
  const exact = { agentMs: 138_072, wallMs: 138_072, tokens: 980 };
  assert.deepEqual(mergedStats(item([pr(1, 'merged', statsBlock(exact))], null)), { ...exact, frozen: true });
});

test('a body without a block gets one appended; the text before it is kept byte for byte', () => {
  const body = '## What\r\nThe change.  \r\n';
  assert.equal(withStatsBlock(body, block), `${body}\n\n${block}`);
  assert.equal(withStatsBlock('', block), block);
});

test('a body with a block gets only the block replaced', () => {
  const before = 'Intro\r\n\r\n';
  const after = '\r\n\r\n## Verify\r\nSteps <!-- lar-stats --> quoted later';
  const body = `${before}<!-- lar-stats -->\nold numbers\n<!-- /lar-stats -->${after}`;
  assert.equal(withStatsBlock(body, block), `${before}${block}${after}`);
  assert.equal(withStatsBlock(withStatsBlock(body, block), block), `${before}${block}${after}`, 'the same stats leave the body as it is');
});

const pr = (number: number, state: LinkedPr['state'], body: string | undefined, mergedAt?: string): LinkedPr =>
  ({ number, url: `https://github.com/maddec01/lar-factory/pull/${number}`, state, isDraft: false, checks: null, mergeState: 'can merge', body, mergedAt });
const edits = (items: Item[]) => prStatsEdits(items);
const item = (linkedPrs: LinkedPr[], itemStats: Item['stats'] | null = stats, labels = ['build'], repo = 'maddec01/lar-factory') =>
  ({ linkedPrs, stats: itemStats ?? undefined, labels, repo }) as Item;

test('a merged build refreshes an outdated block before freezing and retains its exact final figures', () => {
  const final = { agentMs: 167_550, wallMs: 167_550, tokens: 12_345, costUsd: 0.27 };
  const build = item([pr(1, 'merged', statsBlock({ agentMs: 0, wallMs: 0, tokens: 0 }))], final);
  assert.deepEqual(mergedStats(build, final), { ...final, frozen: true });
  const [edit] = edits([{ ...build, stats: mergedStats(build, final)! }]);
  assert.ok(edit, 'persist the final figures in the merged PR');
  assert.deepEqual(mergedStats(item([pr(1, 'merged', edit.body)], null)), { ...final, frozen: true });
});

test('a running PR keeps exact figures so its rounded display cannot inflate the merged build', () => {
  const live = { agentMs: 167_550, wallMs: 167_550, tokens: 12_345, costUsd: 0.27 };
  const [edit] = edits([item([pr(1, 'open', 'Body')], live)]);
  assert.ok(edit);
  assert.deepEqual(mergedStats(item([pr(1, 'merged', edit.body)], null)), { ...live, frozen: true });
});

test('a stale stats read never lowers known final figures, including when the PR body changed after the board read it', () => {
  const known: ItemStats = { agentMs: 167_550, wallMs: 160_000, tokens: 12_345, costUsd: 0.27, frozen: true };
  const stale = { agentMs: 0, wallMs: 0, tokens: 0 };
  const body = `Latest description\n\n${statsBlock(known)}`;
  assert.deepEqual(mergedStats(item([pr(1, 'merged', body)], known), stale), known);
  assert.deepEqual(edits([item([pr(1, 'merged', body)], { ...stale, frozen: true })]), []);
  assert.equal(updatedBody(body, statsBlock({ ...stale, frozen: true })), null);
});

test('markers count only alone on their own line, so a marker quoted in prose is left as it is', () => {
  const prose = 'The board writes `<!-- lar-stats -->` and <!-- /lar-stats --> markers.';
  assert.equal(withStatsBlock(prose, block), `${prose}\n\n${block}`);
  const quotedThenReal = `Quote: <!-- lar-stats --> here\r\n<!-- lar-stats -->\r\nold\r\n<!-- /lar-stats -->\r\nEnd <!-- /lar-stats -->`;
  assert.equal(withStatsBlock(quotedThenReal, block), `Quote: <!-- lar-stats --> here\r\n${block}\r\nEnd <!-- /lar-stats -->`);
  assert.equal(withStatsBlock('<!-- lar-stats -->\nno end, then <!-- /lar-stats --> inline', block),
    `<!-- lar-stats -->\nno end, then <!-- /lar-stats --> inline\n\n${block}`);
});

test('edits refresh open and merged PRs whose block is missing or out of date, leaving closed ones alone', () => {
  const current = `Body\n\n${block}`;
  assert.deepEqual(edits([item([pr(1, 'open', 'Body'), pr(2, 'merged', 'Body'), pr(3, 'closed', 'Body'), pr(4, 'open', current)])]),
    [{ url: pr(1, 'open', '').url, final: false, block, body: current }]);
  assert.deepEqual(edits([item([pr(5, 'open', current.replaceAll('\n', '\r\n'))])]), [],
    'a block GitHub sent back with CRLF line ends is still current');
  const stale = `Body\n\n${statsBlock({ ...stats, agentMs: 0 })}`;
  assert.deepEqual(edits([item([pr(6, 'open', stale)])]), [{ url: pr(6, 'open', '').url, final: false, block, body: current }]);
});

test('an edit\'s block applies again to a newer body, and a body already current needs none', () => {
  const edited = 'Body edited since the board read it';
  assert.equal(updatedBody(edited, block), `${edited}\n\n${block}`);
  assert.equal(updatedBody(`${edited}\n\n${statsBlock({ ...stats, agentMs: 0 })}`, block), `${edited}\n\n${block}`);
  assert.equal(updatedBody(`${edited}\r\n\r\n${block.replaceAll('\n', '\r\n')}`, block), null);
});

test('PRs in a repo with no items on the board are left alone; any repo with items gets its blocks', () => {
  const elsewhere = { ...pr(7, 'open', 'Body'), url: 'https://github.com/someone/other/pull/7' };
  const prefix = { ...pr(8, 'open', 'Body'), url: 'https://github.com/maddec01/lar-factory-fork/pull/8' };
  const app = { ...pr(10, 'open', 'Body'), url: 'https://github.com/maddec01/lar-app/pull/10' };
  assert.deepEqual(edits([item([elsewhere, prefix, pr(9, 'open', 'Body')]), item([app], stats, ['build'], 'maddec01/lar-app')]).map((e) => e.url),
    [pr(9, 'open', '').url, app.url]);
  assert.deepEqual(edits([item([app]), item([], null, [], 'maddec01/lar-app')]).map((e) => e.url), [app.url],
    'an item without stats still puts its repo on the board');
});

test('only builds write a PR\'s block: a parent that isn\'t a build, linked to the same PR, writes nothing', () => {
  const parent = item([pr(1, 'open', 'Body')], { ...stats, agentMs: 0 }, ['feature']);
  assert.deepEqual(edits([parent, item([pr(1, 'open', 'Body')])]), [{ url: pr(1, 'open', '').url, final: false, block, body: `Body\n\n${block}` }]);
  assert.deepEqual(edits([parent]), []);
  assert.deepEqual(edits([item([pr(2, 'open', 'Body')], stats, ['build', 'concept'])]), [], 'a concept map is no build');
});

test('only builds freeze figures from a merged PR; an issue that isn\'t a build keeps live figures', () => {
  const merged = [pr(1, 'merged', `Body\n\n${block}`)];
  assert.equal(mergedStats(item(merged, null))?.costUsd, 41.2);
  assert.equal(mergedStats(item(merged, stats, ['feature'])), null);
});

test('missing or unavailable stats, or an unread body, make no edit; a PR linked twice is edited once', () => {
  assert.deepEqual(edits([item([pr(1, 'open', 'Body')], null), item([pr(2, 'open', 'Body')], 'unavailable'),
    item([pr(3, 'open', undefined)])]), []);
  assert.equal(edits([item([pr(1, 'open', 'Body')]), item([pr(1, 'open', 'Body')], { ...stats, agentMs: 0 })]).length, 1);
});

test('a merged PR gets final stats, then needs no further edit', () => {
  const stale = `Body\n\n${statsBlock({ ...stats, agentMs: 0 })}`;
  const [edit] = edits([item([pr(1, 'merged', stale)], { ...stats, frozen: true })]);
  assert.ok(edit?.final);
  assert.deepEqual(edits([item([pr(1, 'merged', edit.body)], { ...stats, frozen: true })]), []);
});

test('a merged item takes the figures its merged PR\'s block holds, frozen, as the block wrote them', () => {
  const frozen = (s: ItemStats) => mergedStats(item([pr(1, 'merged', `Body\n\n${statsBlock(s)}\n\nMore`)], null));
  assert.deepEqual(frozen(stats), { ...stats, frozen: true });
  assert.deepEqual(frozen({ agentMs: 7 * 60_000, tokens: 980 }), { agentMs: 7 * 60_000, tokens: 980, frozen: true }, 'nothing priced, no cost');
  assert.deepEqual(frozen({ agentMs: 3 * 3600_000 + 17 * 60_000, tokens: 1_234_567_000_000, costUsd: 1234.5 }),
    { agentMs: (3 * 60 + 17) * 60_000, tokens: 1_234_567_000_000, costUsd: 1234.5, frozen: true });
  assert.equal(frozen({ ...stats, costUsd: 0.3 })?.costUsd, 0.3, 'the data retains cents below a dollar');
  assert.deepEqual(frozen({ agentMs: 195 * 60_000, wallMs: 75 * 60_000, tokens: 980 }),
    { agentMs: 195 * 60_000, wallMs: 75 * 60_000, tokens: 980, frozen: true }, 'wall time over an hour');
  for (const s of [stats, { agentMs: 0, tokens: 0 }, { agentMs: 90 * 60_000, wallMs: 0, tokens: 40_200, costUsd: 0.4 }]) {
    assert.equal(statsBlock(frozen(s)!), statsBlock(s), 'the parsed figures write the same block back');
  }
  const crlf = mergedStats(item([pr(1, 'merged', `Body\r\n\r\n${statsBlock(stats).replaceAll('\n', '\r\n')}`)], null));
  assert.equal(crlf?.costUsd, 41.2, 'a block GitHub sent back with CRLF line ends still parses');
});

test('a merged item reads a block in the old format, from before wall time, with no wall time', () => {
  const old = (figures: string) => mergedStats(item([pr(1, 'merged', `Body\n\n<!-- lar-stats -->\n**Item stats** (kept current by the lar board): ${figures}\n<!-- /lar-stats -->`)], null));
  assert.deepEqual(old('agent time 3h 15m · 12.4M tokens · $41'), { agentMs: 195 * 60_000, tokens: 12_400_000, costUsd: 41, frozen: true });
  assert.deepEqual(old('agent time 5m · 980 tokens'), { agentMs: 5 * 60_000, tokens: 980, frozen: true }, 'nothing priced, no cost');
});

test('a merged item falls back to live stats when no merged PR has a readable block', () => {
  const garbled = '<!-- lar-stats -->\n**Item stats**: agent time soon · lots of tokens\n<!-- /lar-stats -->';
  assert.equal(mergedStats(item([pr(1, 'merged', 'Body without a block')])), null);
  assert.equal(mergedStats(item([pr(1, 'merged', garbled)])), null);
  assert.equal(mergedStats(item([pr(1, 'merged', undefined)])), null, 'an unread body');
  assert.equal(mergedStats(item([pr(1, 'open', `Body\n\n${block}`), pr(2, 'closed', `Body\n\n${block}`)])), null, 'only merged PRs freeze');
  assert.equal(mergedStats(item([pr(1, 'merged', garbled), pr(2, 'merged', `Body\n\n${block}`)], null))?.costUsd, 41.2,
    'a merged PR with a readable block counts');
});

test('a merged item reads its most recently merged PR\'s block, and an open linked PR keeps it live', () => {
  const older = `Body\n\n${statsBlock({ ...stats, costUsd: 10 })}`;
  const newer = `Body\n\n${statsBlock({ ...stats, costUsd: 41 })}`;
  assert.equal(mergedStats(item([pr(1, 'merged', older, '2026-10-01T00:00:00Z'), pr(2, 'merged', newer, '2026-10-20T00:00:00Z')], null))?.costUsd, 41);
  assert.equal(mergedStats(item([pr(2, 'merged', newer, '2026-10-20T00:00:00Z'), pr(1, 'merged', older, '2026-10-01T00:00:00Z')], null))?.costUsd, 41,
    'whatever order GitHub lists them in');
  assert.equal(mergedStats(item([pr(1, 'merged', newer, '2026-10-20T00:00:00Z'), pr(2, 'open', 'Body')])), null, 'an open PR: live stats');
});
