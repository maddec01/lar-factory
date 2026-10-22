import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prStatsEdits, statsBlock, withStatsBlock } from '../src/pr-stats.ts';
import type { Item, ItemStats, LinkedPr } from '../src/model.ts';

const stats: ItemStats = { agentMs: 65 * 60_000, tokens: { input: 1_234_567, cached: 900_000, output: 40_200, lowerBound: true },
  subagentTokens: { input: 305, cached: 300, output: 9 } };
const block = statsBlock(stats);

test('the block shows agent time, T3 tokens marked as a lower bound, and subagent tokens, between markers', () => {
  assert.equal(block, '<!-- mux-stats -->\n**Item stats** (kept current by the Mux board): agent time 1h 0m · T3 tokens ≥1.2M in (900k cached) / 40k out · Claude subagents 305 in (300 cached) / 9 out\n<!-- /mux-stats -->');
  assert.equal(statsBlock({ ...stats, tokens: { ...stats.tokens, lowerBound: false }, subagentTokens: undefined }),
    '<!-- mux-stats -->\n**Item stats** (kept current by the Mux board): agent time 1h 0m · T3 tokens 1.2M in (900k cached) / 40k out\n<!-- /mux-stats -->');
});

test('the block rounds agent time to 5 minutes under an hour and to 15 from an hour, so a running turn rarely rewrites it', () => {
  const time = (minutes: number) => /agent time ([^·]+) ·/.exec(statsBlock({ ...stats, agentMs: minutes * 60_000 }))?.[1];
  assert.deepEqual([0.4, 2.4, 2.6, 52, 57.4, 59.9].map(time), ['0m', '0m', '5m', '50m', '55m', '1h 0m']);
  assert.deepEqual([60, 67.4, 67.6, 128, 135].map(time), ['1h 0m', '1h 0m', '1h 15m', '2h 15m', '2h 15m']);
  assert.equal(prStatsEdits([item([pr(1, 'OPEN', `Body\n\n${block}`)], { ...stats, agentMs: 66 * 60_000 })]).length, 0,
    'a minute more agent time leaves the block alone');
});

test('a body without a block gets one appended; the text before it is kept byte for byte', () => {
  const body = '## What\r\nThe change.  \r\n';
  assert.equal(withStatsBlock(body, block), `${body}\n\n${block}`);
  assert.equal(withStatsBlock('', block), block);
});

test('a body with a block gets only the block replaced', () => {
  const before = 'Intro\r\n\r\n';
  const after = '\r\n\r\n## Verify\r\nSteps <!-- mux-stats --> quoted later';
  const body = `${before}<!-- mux-stats -->\nold numbers\n<!-- /mux-stats -->${after}`;
  assert.equal(withStatsBlock(body, block), `${before}${block}${after}`);
  assert.equal(withStatsBlock(withStatsBlock(body, block), block), `${before}${block}${after}`, 'the same stats leave the body as it is');
});

const pr = (number: number, state: string, body: string | undefined): LinkedPr =>
  ({ number, url: `https://github.com/maddec01/mux-factory/pull/${number}`, state, isDraft: false, checks: null, body });
const item = (linkedPrs: LinkedPr[], itemStats: Item['stats'] | null = stats) => ({ linkedPrs, stats: itemStats ?? undefined }) as Item;

test('markers count only alone on their own line, so a marker quoted in prose is left as it is', () => {
  const prose = 'The board writes `<!-- mux-stats -->` and <!-- /mux-stats --> markers.';
  assert.equal(withStatsBlock(prose, block), `${prose}\n\n${block}`);
  const quotedThenReal = `Quote: <!-- mux-stats --> here\r\n<!-- mux-stats -->\r\nold\r\n<!-- /mux-stats -->\r\nEnd <!-- /mux-stats -->`;
  assert.equal(withStatsBlock(quotedThenReal, block), `Quote: <!-- mux-stats --> here\r\n${block}\r\nEnd <!-- /mux-stats -->`);
  assert.equal(withStatsBlock('<!-- mux-stats -->\nno end, then <!-- /mux-stats --> inline', block),
    `<!-- mux-stats -->\nno end, then <!-- /mux-stats --> inline\n\n${block}`);
});

test('edits go to open linked PRs whose block is missing or out of date, never to closed or merged ones', () => {
  const current = `Body\n\n${block}`;
  assert.deepEqual(prStatsEdits([item([pr(1, 'OPEN', 'Body'), pr(2, 'MERGED', 'Body'), pr(3, 'CLOSED', 'Body'), pr(4, 'OPEN', current)])]),
    [{ url: pr(1, 'OPEN', '').url, body: current }]);
  assert.deepEqual(prStatsEdits([item([pr(5, 'OPEN', current.replaceAll('\n', '\r\n'))])]), [],
    'a block GitHub sent back with CRLF line ends is still current');
  const stale = `Body\n\n${statsBlock({ ...stats, agentMs: 0 })}`;
  assert.deepEqual(prStatsEdits([item([pr(6, 'OPEN', stale)])]), [{ url: pr(6, 'OPEN', '').url, body: current }]);
});

test('missing or unavailable stats, or an unread body, make no edit; a PR linked twice is edited once', () => {
  assert.deepEqual(prStatsEdits([item([pr(1, 'OPEN', 'Body')], null), item([pr(2, 'OPEN', 'Body')], 'unavailable'),
    item([pr(3, 'OPEN', undefined)])]), []);
  assert.equal(prStatsEdits([item([pr(1, 'OPEN', 'Body')]), item([pr(1, 'OPEN', 'Body')], { ...stats, agentMs: 0 })]).length, 1);
});
