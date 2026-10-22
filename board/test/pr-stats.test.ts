import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prStatsEdits, statsBlock, updatedBody, withStatsBlock } from '../src/pr-stats.ts';
import type { Item, ItemStats, LinkedPr } from '../src/model.ts';

const stats: ItemStats = { agentMs: 65 * 60_000, tokens: 12_436_000, costUsd: 41.2 };
const block = statsBlock(stats);

test('the block shows agent time, total tokens and API cost, between markers', () => {
  assert.equal(block, '<!-- mux-stats -->\n**Item stats** (kept current by the Mux board): agent time 1h 0m · 12.4M tokens · $41\n<!-- /mux-stats -->');
  assert.equal(statsBlock({ agentMs: stats.agentMs, tokens: 980 }),
    '<!-- mux-stats -->\n**Item stats** (kept current by the Mux board): agent time 1h 0m · 980 tokens\n<!-- /mux-stats -->', 'nothing priced, no cost');
});

test('the block\'s cost is in whole dollars, to the nearest, and <$1 below a dollar, so cents don\'t rewrite it', () => {
  const cost = (costUsd: number) => / · ([^ ·]+)\n/.exec(statsBlock({ ...stats, costUsd }))?.[1];
  assert.deepEqual([0, 0.004, 0.99, 1, 1.49, 1.5, 41.2, 1234.5].map(cost), ['<$1', '<$1', '<$1', '$1', '$1', '$2', '$41', '$1,235']);
  assert.equal(edits([item([pr(1, 'OPEN', `Body\n\n${block}`)], { ...stats, costUsd: 41.4 })]).length, 0, 'a few cents more leave the block alone');
});

test('the block rounds agent time to 5 minutes under an hour and to 15 from an hour, so a running turn rarely rewrites it', () => {
  const time = (minutes: number) => /agent time ([^·]+) ·/.exec(statsBlock({ ...stats, agentMs: minutes * 60_000 }))?.[1];
  assert.deepEqual([0.4, 2.4, 2.6, 52, 57.4, 59.9].map(time), ['0m', '0m', '5m', '50m', '55m', '1h 0m']);
  assert.deepEqual([60, 67.4, 67.6, 128, 135].map(time), ['1h 0m', '1h 0m', '1h 15m', '2h 15m', '2h 15m']);
  assert.equal(edits([item([pr(1, 'OPEN', `Body\n\n${block}`)], { ...stats, agentMs: 66 * 60_000 })]).length, 0,
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
const REPOS = ['maddec01/mux-factory'];
const edits = (items: Item[]) => prStatsEdits(items, REPOS);
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
  assert.deepEqual(edits([item([pr(1, 'OPEN', 'Body'), pr(2, 'MERGED', 'Body'), pr(3, 'CLOSED', 'Body'), pr(4, 'OPEN', current)])]),
    [{ url: pr(1, 'OPEN', '').url, block, body: current }]);
  assert.deepEqual(edits([item([pr(5, 'OPEN', current.replaceAll('\n', '\r\n'))])]), [],
    'a block GitHub sent back with CRLF line ends is still current');
  const stale = `Body\n\n${statsBlock({ ...stats, agentMs: 0 })}`;
  assert.deepEqual(edits([item([pr(6, 'OPEN', stale)])]), [{ url: pr(6, 'OPEN', '').url, block, body: current }]);
});

test('an edit\'s block applies again to a newer body, and a body already current needs none', () => {
  const edited = 'Body edited since the board read it';
  assert.equal(updatedBody(edited, block), `${edited}\n\n${block}`);
  assert.equal(updatedBody(`${edited}\n\n${statsBlock({ ...stats, agentMs: 0 })}`, block), `${edited}\n\n${block}`);
  assert.equal(updatedBody(`${edited}\r\n\r\n${block.replaceAll('\n', '\r\n')}`, block), null);
});

test('PRs in a repo config.json doesn\'t list are left alone', () => {
  const elsewhere = { ...pr(7, 'OPEN', 'Body'), url: 'https://github.com/someone/other/pull/7' };
  const prefix = { ...pr(8, 'OPEN', 'Body'), url: 'https://github.com/maddec01/mux-factory-fork/pull/8' };
  assert.deepEqual(edits([item([elsewhere, prefix, pr(9, 'OPEN', 'Body')])]).map((e) => e.url), [pr(9, 'OPEN', '').url]);
});

test('missing or unavailable stats, or an unread body, make no edit; a PR linked twice is edited once', () => {
  assert.deepEqual(edits([item([pr(1, 'OPEN', 'Body')], null), item([pr(2, 'OPEN', 'Body')], 'unavailable'),
    item([pr(3, 'OPEN', undefined)])]), []);
  assert.equal(edits([item([pr(1, 'OPEN', 'Body')]), item([pr(1, 'OPEN', 'Body')], { ...stats, agentMs: 0 })]).length, 1);
});
