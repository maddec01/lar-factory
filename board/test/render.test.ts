// Saved-copy test: renders test/sample.json and compares it with test/expected/.
// Run `npm run test:update` to rewrite the saved copies after a deliberate change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { renderPage } from '../src/page.ts';
import { DEFAULT_UI, renderAddItemForm, renderApp, renderBoardView, renderFlowView } from '../src/render.ts';
import type { ItemAction, RenderOptions } from '../src/render.ts';
import type { BoardData } from '../src/model.ts';

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
  assert.equal(actual, expected, `${name} differs from the saved copy; run npm run test:update if intended`);
}

test('page: header, stale banner and both views', () => {
  matchesSaved('page.html', renderPage(sample, base));
});

test('board view, with List and Done expanded', () => {
  matchesSaved(
    'board.html',
    renderBoardView(sample, { ...base, ui: { ...DEFAULT_UI, open: ['list-server', 'list-apple', 'list-draft', 'done-list'] } }),
  );
});

test('flow view, all paths', () => {
  matchesSaved('flow.html', renderFlowView(sample, { ...base, ui: { ...DEFAULT_UI, view: 'flow' } }));
});

test('flow view, foggy concept tab', () => {
  matchesSaved('flow-fog.html', renderFlowView(sample, { ...base, ui: { ...DEFAULT_UI, view: 'flow', flowTab: 'fog' } }));
});

test('capture form uses configured repositories and explains empty applicability selections', () => {
  const html = renderAddItemForm({ ...sample, repos: [
    ...sample.repos, { repo: 'maddec01/mux-factory', platform: 'Factory' },
  ] });
  for (const text of ['Server', 'Apple', 'Factory', 'bug', 'feature', 'improvement', 'app: books', 'os: watchos',
    'area: server', 'area: web', 'No apps selected means all apps.', 'No OSes selected means all OSes.',
    'Selecting neither means both server and web.']) assert.ok(html.includes(text), text);
  assert.match(html, /<label for="item-title">Title/);
  assert.match(html, /id="item-title"[^>]*required/);
  assert.match(html, /<label for="item-description">Description/);
  assert.match(html, /role="status"/);
  assert.ok(!html.includes('data-applicability="maddec01/mux-factory"'));
});

test('entered titles round-trip through bootstrap JSON without closing its script element', () => {
  const title = 'Play <queue> & "mix" </script>';
  const data = { ...sample, items: [{ ...sample.items[0]!, title }] };
  const html = renderPage(data, base);
  const embedded = html.match(/<script id="board-data" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(embedded);
  assert.equal((JSON.parse(embedded) as BoardData).items[0]?.title, title);
  assert.ok(!embedded.includes('</script>'));
});

const buttons = (html: string, attr: string) => [...html.matchAll(new RegExp(`${attr}="([^"]+)"`, 'g'))].map((m) => m[1]);
const ids = (status: string) => sample.items.filter((i) => i.status === status).map((i) => i.id);

test('Queue buttons appear only on List rows and show the action in flight or its error', () => {
  const html = renderBoardView(sample, base);
  assert.deepEqual(buttons(html, 'data-queue').sort(), ids('List').sort());
  const [first, second] = ids('List') as [string, string];
  const acting = renderBoardView(sample, { ...base, actions: {
    [first]: { phase: 'pending' }, [second]: { phase: 'error', message: 'Could not set Queued.' } } });
  assert.match(acting, new RegExp(`data-queue="${first}"[^>]*aria-disabled="true"[^>]*>Queuing…</button>`));
  assert.match(acting, /<span class="action-error" role="alert">Could not set Queued.<\/span><button[^>]*data-queue/);
});

test('a queued or added item is announced in the header', () => {
  const item = sample.items[0]!;
  assert.match(renderApp(sample, { ...base, notice: { verb: 'Moved', item, to: 'Queued' } }),
    /role="status">Moved <a[^>]*>.*<\/a> to Queued\.<\/div>/);
});

test('Start appears only on Queued issues; a queued draft asks for an issue first', () => {
  const html = renderBoardView(sample, base);
  const issues = sample.items.filter((i) => i.status === 'Queued' && i.number !== null).map((i) => i.id);
  assert.deepEqual(buttons(html, 'data-start').sort(), issues.sort());
  const draftCard = html.split('<article').find((c) => c.includes('Offline downloads on watchOS'))!;
  assert.match(draftCard, /needs an issue/);
  assert.ok(!draftCard.includes('data-start') && !draftCard.includes('data-copy'));
  assert.match(html.split('<article').find((c) => c.includes('data-start'))!, /data-copy="\/mux-work /, 'Copy stays as a fallback');
});

test('Start shows its progress, the started thread, or the error', () => {
  const [a, b, c, d] = ['PVTI_sample05', 'PVTI_sample06', 'PVTI_sample05', 'PVTI_sample06'];
  const card = (actions: Record<string, ItemAction>, id: string) =>
    renderBoardView(sample, { ...base, actions }).split('<article').find((x) => x.includes(`href="${sample.items.find((i) => i.id === id)!.url}"`))!;
  assert.match(card({ [a]: { phase: 'pending' } }, a), /data-start="PVTI_sample05"[^>]*aria-disabled="true"[^>]*>Starting…</);
  const started = card({ [b]: { phase: 'started', thread: { threadId: 'thread-1', title: '/mux-work maddec01/mux-apple#20' } } }, b);
  assert.match(started, /role="status"[^>]*>Started T3 thread <code class="thread-id">thread-1<\/code>/, 'a title that is just the command is not repeated');
  assert.match(started, /thread-1/);
  assert.ok(!started.includes('data-start="'));
  const failed = card({ [c]: { phase: 'error', message: 'T3 is down.' } }, c);
  assert.match(failed, /<div class="meta">.*<button[^>]*data-start[^>]*>Retry start<\/button><\/div>/, 'Start sits in the top row');
  assert.match(failed, /role="alert">T3 is down.</);
  const unsure = card({ [d]: { phase: 'uncertain', message: 'Check T3.' } }, d);
  assert.match(unsure, /role="alert">Check T3.</);
  assert.ok(!unsure.includes('data-start="'));
});

test('copy describes the Queue and Start buttons instead of dragging or typing /mux-work', () => {
  const html = renderBoardView({ ...sample, items: [] }, base) + renderFlowView(sample, base);
  assert.ok(!/drag|in a new T3 thread/i.test(html));
  assert.match(html, /Nothing queued\. Press Queue on a List item/);
});

test('a thread another page started shows on every page, and sample mode disables both buttons', () => {
  const started = renderBoardView({ ...sample, started: { PVTI_sample05: { threadId: 'thread-9', title: 'Shape the playback queue' } } }, base);
  assert.match(started, /Started T3 thread <b>Shape the playback queue<\/b> <code class="thread-id">thread-9<\/code>/);
  assert.ok(!started.includes('data-start="PVTI_sample05"'));
  const off = renderBoardView({ ...sample, capture: { session: 's', enabled: false } }, base);
  assert.ok([...off.matchAll(/<button[^>]*data-(?:queue|start)="[^"]*"[^>]*>/g)].every((m) => m[0].includes(' disabled')));
});
