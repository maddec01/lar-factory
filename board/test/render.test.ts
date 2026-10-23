// Saved-copy test: renders test/sample.json and compares it with test/expected/.
// Run `pnpm run test:update` to rewrite the saved copies after a deliberate change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { renderPage } from '../src/page.ts';
import { DEFAULT_UI } from '../src/ui-state.ts';
import { formatTokens, formatUsd } from '../src/format.ts';
import { answeredRecheck, recheckAnswer, renderApp, renderHeader } from '../src/render.ts';
import type { RenderOptions } from '../src/render.ts';
import type { BoardData } from '../src/model.ts';

// The source index.html stands in for the built one, whose asset names change with every build.
const template = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sample = JSON.parse(readFileSync(new URL('./sample.json', import.meta.url), 'utf8')) as BoardData;
const expectedDir = new URL('./expected/', import.meta.url);
const update = process.env.UPDATE_EXPECTED === '1';

// Fixed clock and zone so the output doesn't depend on when or where it runs.
const base: RenderOptions = { now: Date.parse('2026-10-21T10:00:00Z'), timeZone: 'UTC', ui: DEFAULT_UI };

function matchesSaved(name: string, actual: string): void {
  const file = new URL(name, expectedDir);
  if (update) {
    mkdirSync(expectedDir, { recursive: true });
    writeFileSync(file, actual);
    return;
  }
  const expected = readFileSync(file, 'utf8');
  assert.equal(actual, expected, `${name} differs from the saved copy; run pnpm run test:update if intended`);
}

test('page: the app root and the board data for its first paint', () => {
  matchesSaved('page.html', renderPage(template, sample));
});

test('the header and the tab show the Mux logo followed by "factory"', () => {
  const page = renderPage(template, sample);
  assert.match(page, /<title>µx factory<\/title>/);
  assert.match(page, /<link rel="icon" href="data:image\/svg\+xml,[^"]*viewBox%3D%220%200%2056%2032%22/, 'the favicon is the logo');
  const h1 = renderHeader(sample, base).match(/<h1>(.*?)<\/h1>/)?.[1] ?? '';
  assert.match(h1, /^<svg class="brand-mark" role="img" aria-label="Mux" viewBox="0 0 56 32"[^>]*><path d="M5 3\.5v25M5 3\.5V12a8\.5 8\.5 0 0 0 17 0V3\.5M22 12c0 4\.5 2 7\.5 5\.5 7\.5M36 3\.5l14 17M50 3\.5l-14 17"/);
  assert.match(h1, /<\/svg><span>factory<\/span>$/);
  assert.ok(!page.includes('Mux factory board'));
});

test('entered titles round-trip through bootstrap JSON without closing its script element', () => {
  const title = 'Play <queue> & "mix" </script>';
  const data = { ...sample, items: [{ ...sample.items[0]!, title }] };
  const html = renderPage(template, data);
  const embedded = html.match(/<script id="board-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(embedded);
  assert.equal((JSON.parse(embedded) as BoardData).items[0]?.title, title);
  assert.ok(!embedded.includes('</script>'));
});

const ids = (status: string) => sample.items.filter((i) => i.status === status).map((i) => i.id);

test('token counts are compact as on T3 Code\'s usage page', () => {
  assert.deepEqual([0, 980, 1_000, 1_234, 40_200, 312_400, 999_999, 1_200_000, 12_436_000, 2.5e9, 3e12].map(formatTokens),
    ['0', '980', '1K', '1.23K', '40.2K', '312K', '1000K', '1.20M', '12.4M', '2.50B', '3T']);
});

test('costs are shown as on T3 Code\'s usage page', () => {
  assert.deepEqual([0.004, 41.2, 1234.567].map(formatUsd), ['$0.00', '$41.20', '$1,234.57']);
});

test('a missing t3 replaces the board with a notice and Recheck', () => {
  const page = renderApp({ ...sample, tools: { t3: { problem: 'missing' } } }, base);
  matchesSaved('t3-missing.html', page);
  assert.match(page, /T3 Code not found/);
  assert.match(page, /data-recheck/);
  assert.doesNotMatch(page, /role="tab"/, 'the notice replaces the board');
  const broken = renderApp({ ...sample, tools: { t3: { problem: 'missing', override: 'T3_PATH=/nowhere/t3' } } }, base);
  assert.match(broken, /<code>T3_PATH=\/nowhere\/t3<\/code>/, 'a broken override is named');
});

test('after Recheck a notice that stays says the tool is still missing, or why Recheck failed', () => {
  const t3 = { ...sample, tools: { t3: { problem: 'missing' as const } } };
  assert.doesNotMatch(renderApp(t3, base), /recheck-note/, 'nothing before a Recheck');
  assert.match(renderApp(t3, { ...base, rechecked: recheckAnswer(null, t3) }), /<span class="recheck-note" role="status">Still not found\.<\/span>/);
  const loggedOut = { ...sample, tools: { gh: { problem: 'logged-out' as const } } };
  assert.match(renderHeader(loggedOut, { ...base, rechecked: recheckAnswer(null, loggedOut) }), /role="status">Still logged out\.</);
  assert.match(renderHeader(loggedOut, { ...base, rechecked: recheckAnswer("Can't reach the board server. Try again.", loggedOut) }),
    /role="status">Can&#39;t reach the board server\. Try again\.</);
  assert.doesNotMatch(renderHeader(loggedOut, { ...base, rechecking: true, rechecked: recheckAnswer(null, loggedOut) }), /recheck-note/, 'not while checking');
});

test('a Recheck note answers only the tool problems it found, and goes once they change', () => {
  const loggedOut = { ...sample, tools: { gh: { problem: 'logged-out' as const } } };
  const missing = { ...sample, tools: { gh: { problem: 'missing' as const } } };
  const working = { ...sample, tools: {} };
  const answer = recheckAnswer(null, loggedOut);
  assert.equal(answeredRecheck(answer, loggedOut), answer, 'kept while gh is still logged out');
  assert.equal(answeredRecheck(answer, missing), undefined, 'a different problem is not what Recheck answered');
  assert.equal(answeredRecheck(answer, working), undefined, 'gone once the notice clears');
  // The page keeps what answeredRecheck returns, so a gh that logs out again opens a banner without the note.
  assert.doesNotMatch(renderHeader(loggedOut, { ...base, rechecked: answeredRecheck(answeredRecheck(answer, working), loggedOut) }), /recheck-note/);
});

test("a failed Recheck's note goes with the next board data, a found problem's note stays", () => {
  const loggedOut = { ...sample, tools: { gh: { problem: 'logged-out' as const } } };
  const found = recheckAnswer(null, loggedOut);
  assert.equal(answeredRecheck(found, loggedOut, true), found, 'Still logged out stays across polls');
  const failed = recheckAnswer("Can't reach the board server. Try again.", loggedOut);
  assert.equal(answeredRecheck(failed, loggedOut), failed, 'kept until board data arrives');
  assert.equal(answeredRecheck(failed, loggedOut, true), undefined, 'gone once the server answers again');
});

test('a missing or logged-out gh shows its own notice instead of Stale', () => {
  const failed = { ...sample, error: 'gh api graphql failed: HTTP 401' };
  const missing = renderHeader({ ...failed, tools: { gh: { problem: 'missing' } } }, base);
  matchesSaved('gh-missing.html', missing);
  assert.match(missing, /brew install gh/);
  assert.doesNotMatch(missing, /<strong>Stale\.<\/strong>/);
  const loggedOut = renderHeader({ ...failed, tools: { gh: { problem: 'logged-out' } } }, base);
  matchesSaved('gh-logged-out.html', loggedOut);
  assert.match(loggedOut, /gh auth login/);
  assert.doesNotMatch(loggedOut, /<strong>Stale\.<\/strong>/);
  const broken = renderHeader({ ...sample, tools: { gh: { problem: 'missing', override: 'GH_PATH=/nowhere/gh' } } }, base);
  assert.match(broken, /<code>GH_PATH=\/nowhere\/gh<\/code>/, 'a broken override is named');
  assert.match(renderHeader({ ...failed, tools: {} }, base), /<strong>Stale\.<\/strong> .*HTTP 401/s, 'other read failures stay Stale');
});
