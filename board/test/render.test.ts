// Saved-copy test: renders test/sample.json and compares it with test/expected/.
// Run `pnpm run test:update` to rewrite the saved copies after a deliberate change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { renderPage } from '../src/page.ts';
import { DEFAULT_UI, abandonPrompt, renderAddItemForm, renderApp, renderBoardView, renderFlowView, renderHeader } from '../src/render.ts';
import type { ItemAction, RenderOptions } from '../src/render.ts';
import type { BoardData } from '../src/model.ts';
import { normalizeItems } from '../src/github.ts';
import type { RawItem } from '../src/github.ts';

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

test('page: header, stale banner and both views', () => {
  matchesSaved('page.html', renderPage(sample, base));
});

test('the header and the tab show the Mux logo followed by "factory"', () => {
  const page = renderPage(sample, base);
  assert.match(page, /<title>µx factory<\/title>/);
  assert.match(page, /<link rel="icon" href="data:image\/svg\+xml,[^"]*viewBox%3D%220%200%2056%2032%22/, 'the favicon is the logo');
  const h1 = renderHeader(sample, base).match(/<h1>(.*?)<\/h1>/)?.[1] ?? '';
  assert.match(h1, /^<svg class="brand-mark" role="img" aria-label="Mux" viewBox="0 0 56 32"[^>]*><path d="M5 3\.5v25M5 3\.5V12a8\.5 8\.5 0 0 0 17 0V3\.5M22 12c0 4\.5 2 7\.5 5\.5 7\.5M36 3\.5l14 17M50 3\.5l-14 17"/);
  assert.match(h1, /<\/svg><span>factory<\/span>$/);
  assert.ok(!page.includes('Mux factory board'));
});

test('code updates have a copyable command and a warning independent of project staleness', () => {
  const data: BoardData = { ...sample, fetchedAt: new Date(base.now).toISOString(), error: null, codeUpdate: {
    runningRevision: 'a'.repeat(40), remoteRevision: 'b'.repeat(40), behind: 2, error: null,
    command: "bash '/Users/pedro/Developer/Mux/mux-factory/board/scripts/update.sh'", updatable: false,
    logs: { update: '/Users/pedro/Library/Logs/mux-board-update.log', board: '/Users/pedro/Library/Logs/mux-board.log' },
  } };
  const html = renderPage(data, base);
  matchesSaved('update-notice.html', html);
  assert.match(html, /Board update available/);
  assert.match(html, /aria-label="Copy board update command"/);
  assert.ok(!html.includes('<strong>Stale.</strong>'));
  const failed = renderApp({ ...data, codeUpdate: { ...data.codeUpdate!, error: 'Network unavailable.' } }, base);
  assert.match(failed, /Board update available/);
  assert.match(failed, /Board update check failed/);
  const unknown = renderApp({ ...data, codeUpdate: { ...data.codeUpdate!, behind: null } }, base);
  assert.match(unknown, /Checking for board updates/);
  assert.ok(!unknown.includes('Board update available'));
});

test('the launch-agent board offers Update: in the header, or on the banner when behind', () => {
  const codeUpdate = { runningRevision: 'a'.repeat(40), remoteRevision: 'a'.repeat(40), behind: 0, error: null,
    command: "bash '/Users/pedro/Developer/Mux/mux-factory/board/scripts/update.sh'", updatable: true,
    logs: { update: '/Users/pedro/Library/Logs/mux-board-update.log', board: '/Users/pedro/Library/Logs/mux-board.log' } };
  const data: BoardData = { ...sample, fetchedAt: new Date(base.now).toISOString(), error: null, codeUpdate };
  const current = renderApp(data, base);
  assert.equal(current.match(/data-update/g)?.length, 1);
  assert.match(current, /class="title-row".*data-update/);
  const behind = renderApp({ ...data, codeUpdate: { ...codeUpdate, remoteRevision: 'b'.repeat(40), behind: 2 } }, base);
  assert.equal(behind.match(/data-update/g)?.length, 1);
  assert.match(behind, /Board update available.<\/strong> <button[^>]*data-update/);
  assert.ok(!behind.includes('aria-label="Copy board update command"'), 'Update replaces the copy button');
  const dev = renderApp({ ...data, codeUpdate: { ...codeUpdate, updatable: false } }, base);
  assert.ok(!dev.includes('data-update'));
});

test('an update shows its steps as they finish, then its result', () => {
  const codeUpdate = { runningRevision: 'a'.repeat(40), remoteRevision: 'b'.repeat(40), behind: 1, error: null,
    command: "bash '/Users/pedro/Developer/Mux/mux-factory/board/scripts/update.sh'", updatable: true,
    logs: { update: '/Users/pedro/Library/Logs/mux-board-update.log', board: '/Users/pedro/Library/Logs/mux-board.log' } };
  const progress = { state: 'running' as const, pid: 1, finished: ['check' as const, 'fetch' as const], current: 'install' as const,
    startedAt: '2026-10-21T09:59:00Z', finishedAt: null, revision: 'b'.repeat(40), error: null, logTail: null };
  const data: BoardData = { ...sample, fetchedAt: new Date(base.now).toISOString(), error: null, codeUpdate, update: progress };
  const running = renderApp(data, base);
  matchesSaved('update-running.html', renderHeader(data, base));
  assert.match(running, /<li class="finished">check<\/li><li class="finished">fetch<\/li><li class="current" aria-current="step">install<\/li>/);
  assert.match(running, /aria-disabled="true">Updating…/);
  assert.ok(!running.includes('Board update available'), 'the progress replaces the notice while the update runs');
  assert.equal(running.match(/data-update/g)?.length, 1);
  const failed: BoardData = { ...data, update: { ...progress, state: 'failed', finishedAt: '2026-10-21T09:59:30Z',
    error: 'pnpm exited with code 1.', logTail: 'ERR_PNPM_OUTDATED_LOCKFILE missing lockfile\n<script>' } };
  const failure = renderHeader(failed, base);
  matchesSaved('update-failed.html', failure);
  assert.match(failure, /Update failed at install/);
  assert.match(failure, /ERR_PNPM_OUTDATED_LOCKFILE missing lockfile\n&lt;script&gt;/);
  assert.match(failure, /press Update/);
  assert.match(failure, />Update<\/button>/, 'Update is available again to retry');
  const done = renderHeader({ ...data, codeUpdate: { ...codeUpdate, behind: 0 }, update: { ...progress, state: 'done', current: null,
    finished: ['check', 'fetch', 'install', 'restart', 'health', 'skills', 'profiles', 'done'], finishedAt: '2026-10-21T09:59:50Z' } }, base);
  assert.match(done, /<div class="toasts">[\s\S]*<div class="banner toast" role="status" data-expires="update-2026-10-21T09:59:50Z"><button type="button" class="dismiss" data-dismiss="update-2026-10-21T09:59:50Z" aria-label="Dismiss: update finished">&#215;<\/button><strong>Update finished.<\/strong> The board now runs <code>bbbbbbb<\/code>/,
    'a finished update is a toast that clears itself');
  const skipped = renderHeader({ ...data, update: { ...progress, state: 'done', current: null,
    finished: ['check', 'fetch', 'skills', 'profiles', 'done'], finishedAt: '2026-10-21T09:59:50Z' } }, base);
  assert.match(skipped, /already current/);
  assert.match(failure, /role="alert"><button type="button" class="dismiss" data-dismiss="update-2026-10-21T09:59:30Z" aria-label="Dismiss: update failed">&#215;<\/button><strong>Update failed at install/);
  assert.ok(!failure.includes('data-expires'), 'a failure stays until it is dismissed');
  const old = renderHeader({ ...failed, update: { ...failed.update!, finishedAt: '2026-10-21T09:00:00Z' } }, base);
  assert.match(old, /Update failed at install/, 'however old');
  assert.ok(!renderHeader(failed, { ...base, dismissed: new Set(['update-2026-10-21T09:59:30Z']) }).includes('Update failed'), 'until it is dismissed');
  const oldDone = renderHeader({ ...data, update: { ...progress, state: 'done', current: null, finished: ['done'], finishedAt: '2026-10-21T09:00:00Z' } }, base);
  assert.ok(!oldDone.includes('Update finished'), 'an old success leaves the header');
  const lost = renderHeader(data, { ...base, updateView: { phase: 'lost' } });
  matchesSaved('update-lost.html', lost);
  assert.match(lost, /role="alert"><button type="button" class="dismiss" data-dismiss="lost" aria-label="Dismiss: the board didn&#39;t restart">&#215;<\/button><strong>The board didn't restart/);
  assert.ok(!renderHeader(data, { ...base, updateView: { phase: 'lost' }, dismissed: new Set(['lost']) }).includes("didn't restart"));
  assert.match(lost, /mux-board\.log/);
  assert.match(lost, /board\/scripts\/update\.sh/);
  const refused = renderHeader(data, { ...base, updateView: { phase: 'refused', message: 'A Start is running. Press Update when it finishes.' } });
  assert.match(refused, /role="alert"><button type="button" class="dismiss" data-dismiss="refused" aria-label="Dismiss: the update didn&#39;t start">&#215;<\/button><strong>The update didn't start.<\/strong> A Start is running/);
  assert.ok(!renderHeader(data, { ...base, updateView: { phase: 'refused', message: 'x' }, dismissed: new Set(['refused']) }).includes("didn't start"));
  assert.ok(!running.includes('class="dismiss"'), 'progress shows while it runs and has nothing to dismiss');
  assert.match(renderHeader(data, { ...base, updateView: { phase: 'refused', message: 'x' }, dismissed: new Set(['refused']) }), /Updating the board and skills…/,
    'a closed refusal no longer hides the update someone else started');
});

test('board view, with List open by default and Done expanded', () => {
  matchesSaved('board.html', renderBoardView(sample, { ...base, ui: { ...DEFAULT_UI, toggled: { 'done-list': true } } }));
});

test('List groups open by default, Done stays closed, and a Hide closes one group', () => {
  const opened = (html: string) => [...html.matchAll(/<details class="platform" id="([^"]+)" open>/g)].map((m) => m[1]);
  assert.deepEqual(opened(renderBoardView(sample, base)), ['list-server', 'list-apple', 'list-draft']);
  assert.deepEqual(opened(renderBoardView(sample, { ...base, ui: { ...DEFAULT_UI, toggled: { 'list-apple': false } } })),
    ['list-server', 'list-draft']);
});

test('List and Done rows show one pill per label instead of the kind pill', () => {
  const html = renderBoardView(sample, base);
  const rowOf = (id: string) => {
    const item = sample.items.find((i) => i.id === id)!;
    return html.split('<li class="row-item"').find((r) => r.includes(`${item.title}</`))!;
  };
  const pills = (row: string) => [...row.matchAll(/<span class="label kind-[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(pills(rowOf('PVTI_sample03')), ['feature', 'app: music', 'os: ios', 'os: macos']);
  assert.deepEqual(pills(rowOf('PVTI_sample19')), ['bug', 'os: watchos'], 'Done rows too');
  assert.deepEqual(pills(rowOf('PVTI_sample04')), [], 'a draft has no labels');
  for (const id of ['PVTI_sample03', 'PVTI_sample19']) assert.ok(!rowOf(id).includes('class="kind'), 'no separate kind pill');
});

test('flow view: an outline of parent and blocked-by links', () => {
  matchesSaved('flow.html', renderFlowView(sample, { ...base, ui: { ...DEFAULT_UI, view: 'flow' } }));
});

/** One outline node's HTML, nested nodes included. */
function flowNode(html: string, id: string): string {
  const start = html.indexOf(`<li class="o-node" id="o-${id}"`);
  assert.ok(start >= 0, `${id} is in the outline`);
  let depth = 0;
  for (const m of html.slice(start).matchAll(/<li\b|<\/li>/g)) {
    depth += m[0] === '</li>' ? -1 : 1;
    if (!depth) return html.slice(start, start + m.index + 5);
  }
  throw new Error(`${id} never closes`);
}

const hasNode = (html: string, id: string) => html.includes(`<li class="o-node" id="o-${id}"`);

test('Flow nests sub-issues under their parent and counts the ones not on the Board', () => {
  const concept = flowNode(renderFlowView(sample, base), 'PVTI_sample09');
  for (const id of ['PVTI_sample10', 'PVTI_sample12', 'PVTI_sample13', 'PVTI_sample18']) assert.ok(hasNode(concept, id), `${id} nests under #200`);
  assert.match(concept, /<li class="o-missing">2 more sub-issues not on the board<\/li>/, 'six sub-issues, four on the Board');
});

test("a build's slices show no Status of their own, and Flow doesn't count them as missing", () => {
  const build = renderBoardView(sample, base).split('<article').find((a) => a.includes('data-anchor="PVTI_sample13"'))!;
  assert.ok(!/o-status|sub-status|data-anchor="PVTI_slice/.test(build), 'slices are not board items and show no Status');
  assert.ok(!flowNode(renderFlowView(sample, base), 'PVTI_sample13').includes('o-missing'), "a build's slices are never on the board, so none is missing");
});

test('a build counts slices, not sub-issues, in Flow', () => {
  assert.match(flowNode(renderFlowView(sample, base), 'PVTI_sample13'), /<span class="o-subs">1\/3 slices done<\/span>/);
});

// Raw project items as GitHub returns them, so the step that attaches slices runs.
const rawIssue = (id: string, number: number, status: string, labels: string[], extra: Partial<NonNullable<RawItem['content']>> = {}): RawItem => ({
  id, updatedAt: '2026-10-21T08:00:00Z', status: { name: status },
  content: { __typename: 'Issue', number, title: `Issue ${number}`, url: `https://github.com/maddec01/mux-factory/issues/${number}`,
    state: 'OPEN', updatedAt: '2026-10-21T08:00:00Z', repository: { nameWithOwner: 'maddec01/mux-factory' },
    labels: { nodes: labels.map((name) => ({ name })) }, ...extra },
});
const sliceRef = (number: number, state: 'OPEN' | 'CLOSED') => ({ number, title: `Issue ${number}`,
  url: `https://github.com/maddec01/mux-factory/issues/${number}`, state, repository: { nameWithOwner: 'maddec01/mux-factory' } });
const builtIssue = rawIssue('PVTI_build', 59, 'In progress', ['improvement', 'build'], {
  subIssuesSummary: { total: 3, completed: 1 },
  subIssues: { nodes: [sliceRef(65, 'CLOSED'), sliceRef(66, 'OPEN'), sliceRef(67, 'OPEN')] },
});
const boardOf = (raws: RawItem[]): BoardData => ({ ...sample, error: null, items: normalizeItems(raws) });

test('an open slice that the project auto-added is dropped from the board items, header counts and Flow', () => {
  const slice = rawIssue('PVTI_slice66', 66, 'In progress', ['improvement'], {
    parent: { number: 59, title: 'Issue 59', url: 'https://github.com/maddec01/mux-factory/issues/59', state: 'OPEN', repository: { nameWithOwner: 'maddec01/mux-factory' } },
  });
  const other = rawIssue('PVTI_other', 70, 'In progress', ['bug']);
  const data = boardOf([slice, builtIssue, other]);
  assert.deepEqual(data.items.map((i) => i.id), ['PVTI_build', 'PVTI_other'], 'the slice is not a board item, wherever it sits in the project');
  const header = renderHeader(data, base);
  assert.match(header, /<li><b>2<\/b> in flight<\/li>/);
  assert.match(header, /<li><b>2<\/b> items<\/li>/);
  assert.ok(!renderBoardView(data, base).includes('data-anchor="PVTI_slice66"'), 'no card of its own');
  assert.ok(!renderFlowView(data, base).includes('id="o-PVTI_slice66"'), 'no Flow node of its own');
});

test('an improvement labelled build keeps its improvement pill and still carries its slices', () => {
  const [item] = normalizeItems([builtIssue]);
  assert.deepEqual(item?.slices.map((s) => [s.number, s.state]), [[65, 'CLOSED'], [66, 'OPEN'], [67, 'OPEN']]);
  const card = renderBoardView(boardOf([builtIssue]), base).split('<article').find((a) => a.includes('data-anchor="PVTI_build"'))!;
  assert.match(card, /<span class="kind kind-improvement">improvement<\/span>/);
});

/** A build card's slice bar segments, its caption, and its active line ('' when it's collapsed). */
function sliceBar(card: string) {
  const bar = /<ol class="segbar slice-bar" aria-hidden="true">(.*?)<\/ol><span class="bar-label">([^<]+)<\/span>/.exec(card);
  assert.ok(bar, 'the card has a slice bar with a caption');
  return {
    segments: [...bar[1]!.matchAll(/<li class="([^"]+)"><\/li>/g)].map((m) => m[1]),
    caption: bar[2],
    active: /<p class="slices-now">(.*?)<\/p>/.exec(card)?.[1] ?? '',
  };
}

const buildCard = (raws: RawItem[], active: number[] = []) => {
  const keys = new Set(active.map((n) => `maddec01/mux-factory#${n}`));
  const data: BoardData = { ...sample, error: null, items: normalizeItems(raws, keys) };
  return renderBoardView(data, base).split('<article').find((a) => a.includes('data-anchor="PVTI_build"'))!;
};

test('a build card shows its slices as a bar under the status bar, with captions and the active slices named', () => {
  const card = buildCard([builtIssue], [66]);
  assert.deepEqual(sliceBar(card), {
    segments: ['done', 'active', 'waiting'],
    caption: '1/3 · Slices done',
    active: '<span class="slices-active">1 active</span> <span class="ref">#66</span> Issue 66',
  });
  assert.match(card, /<div class="bars"><ol class="segbar steps" aria-hidden="true">.*?<\/ol><span class="bar-label step-label now">6\/10 · In progress<\/span><ol class="segbar slice-bar"/,
    'status bar and slice bar share one grid, captions in its right-hand column');
  assert.ok(!card.includes('class="subs"'), 'the caption replaces the meta row counter');
  assert.ok(!card.includes('row-item'), 'no slice rows on the card');
});

test("a build's slice caption counts only visible slices, and the active line collapses when none is active", () => {
  const raw = rawIssue('PVTI_build', 59, 'In progress', ['build'], {
    subIssuesSummary: { total: 4, completed: 2 },
    subIssues: { nodes: [sliceRef(65, 'CLOSED'), { ...sliceRef(66, 'CLOSED'), stateReason: 'NOT_PLANNED' }, sliceRef(67, 'OPEN'), sliceRef(68, 'OPEN')] },
  });
  assert.deepEqual(sliceBar(buildCard([raw])), { segments: ['done', 'waiting', 'waiting'], caption: '1/3 · Slices done', active: '' });
});

test('a 3-slice and a 14-slice build render the same card structure', () => {
  const build = (count: number) => rawIssue('PVTI_build', 59, 'In progress', ['build'], {
    subIssuesSummary: { total: count, completed: 1 },
    subIssues: { nodes: Array.from({ length: count }, (_, i) => sliceRef(100 + i, i ? 'OPEN' : 'CLOSED')) },
  });
  // Tags only, with the slice bar's segments dropped.
  const shape = (card: string) => card.replace(/(<ol class="segbar slice-bar"[^>]*>).*?<\/ol>/, '$1</ol>').match(/<[^>]+>/g)?.join('');
  assert.equal(shape(buildCard([build(14)], [101, 102])), shape(buildCard([build(3)], [101, 102])));
});

test('a card with sub-issues but no build or concept label shows only its counter', () => {
  const plain = rawIssue('PVTI_plain', 80, 'In progress', ['feature'], {
    subIssuesSummary: { total: 2, completed: 0 }, subIssues: { nodes: [sliceRef(81, 'OPEN'), sliceRef(82, 'OPEN')] },
  });
  const data = boardOf([plain]);
  assert.deepEqual(data.items[0]?.slices, []);
  const card = renderBoardView(data, base).split('<article').find((a) => a.includes('data-anchor="PVTI_plain"'))!;
  assert.match(card, /<span class="subs">0\/2 sub-issues<\/span>/);
  assert.ok(!card.includes('aria-label="Slices"'), 'no fallback list');
});

test('Flow counts none of a build\'s slices as missing, even past the 50 the board query reads', () => {
  const big: BoardData = {
    ...sample,
    items: sample.items.map((i) => (i.id === 'PVTI_sample13' ? { ...i, subIssues: { ...i.subIssues, total: 60 } } : i)),
  };
  assert.ok(!flowNode(renderFlowView(big, base), 'PVTI_sample13').includes('o-missing'));
});

test('Flow shows blocked-by and blocks links from GitHub, jumping to Board items and referencing the rest', () => {
  const html = renderFlowView(sample, base);
  assert.match(flowNode(html, 'PVTI_sample12'), /<li class="o-link blocked-by"><span class="o-rel">blocked by<\/span> <a class="o-ref" href="#flow" data-outline-jump="PVTI_sample10"><b>#201<\/b> Relay: broker only or full TURN\?<\/a> <span class="o-status">Shaping<\/span><\/li>/);
  assert.match(flowNode(html, 'PVTI_sample10'), /<li class="o-link blocks"><span class="o-rel">blocks<\/span> <a class="o-ref" href="#flow" data-outline-jump="PVTI_sample12"><b>#202<\/b> Sign-in screen<\/a>/);
  const owner = flowNode(html, 'PVTI_sample13');
  assert.match(owner, /blocked by<\/span> <a class="o-ref off" href="https:\/\/github\.com\/maddec01\/mux-server\/issues\/118" target="_blank" rel="noopener"><b>#118<\/b> Accounts table migration<\/a> <span class="o-off">not on board · open<\/span>/);
  assert.match(owner, /blocks<\/span> <a class="o-ref" href="#flow" data-outline-jump="PVTI_sample05"><b>#129<\/b>/);
  assert.match(flowNode(html, 'PVTI_sample16'), /blocked by<\/span> <a class="o-ref off" [^>]*><b>#27<\/b> Artwork cache eviction<\/a> <span class="o-off">not on board · closed<\/span>/, 'closed blockers are listed too');
  assert.match(flowNode(html, 'PVTI_sample15'), /blocked by<\/span> <a class="o-ref off" [^>]*><b>#100<\/b> Old cleanup task<\/a> <span class="o-off">not on board · closed<\/span>/,
    'a Done item older than 7 days is hidden, so it counts as not on the Board');
  assert.ok(!hasNode(html, 'PVTI_sample20'), 'and gets no node of its own');
});

test('Flow groups items under a parent that is not on the Board, with its state', () => {
  const html = renderFlowView(sample, base);
  const root = html.slice(html.indexOf('<li class="o-node o-offroot">'));
  assert.match(root, /^<li class="o-node o-offroot">\n<div class="o-row"><a class="o-ref off" href="https:\/\/github\.com\/maddec01\/mux-apple\/issues\/9" target="_blank" rel="noopener"><b>mux-apple#9<\/b> Home screen refresh<\/a> <span class="o-off">not on board · open<\/span><\/div>/);
  assert.ok(hasNode(root, 'PVTI_sample08') && hasNode(root, 'PVTI_sample11'), 'both of its sub-issues sit under it');
  const done = sample.items.find((i) => i.id === 'PVTI_sample20')!;
  const orphan = { ...sample.items[0]!, parent: { number: 100, title: done.title, url: done.url!, repo: done.repo!, state: 'CLOSED' as const } };
  assert.match(renderFlowView({ ...sample, items: [orphan, done] }, base), /<b>mux-server#100<\/b> Old cleanup task<\/a> <span class="o-off">not on board · closed<\/span>/,
    'a hidden parent is a reference too');
});

test('Flow counts links beyond the first ones GitHub returned, and never infers a link', () => {
  const ref = (number: number) => ({ number, title: `Issue ${number}`, url: `https://github.com/maddec01/mux-server/issues/${number}`, repo: 'maddec01/mux-server', state: 'OPEN' as const });
  const blocked = { ...sample.items[0]!, blockers: { total: 23, nodes: [ref(1), ref(2)] }, blocking: { total: 4, nodes: [ref(3)] } };
  const blocker = { ...sample.items[1]!, number: 1, title: 'Issue 1' };
  const html = renderFlowView({ ...sample, items: [blocked, blocker] }, base);
  const node = flowNode(html, blocked.id);
  assert.match(node, /<li class="o-link blocked-by o-more"><span class="o-rel">blocked by<\/span> 21 more issues<\/li>/);
  assert.match(node, /<li class="o-link blocks o-more"><span class="o-rel">blocks<\/span> 3 more issues<\/li>/);
  assert.ok(!hasNode(html, blocker.id) || !flowNode(html, blocker.id).includes('o-link'), "the blocker's own blocking list is empty, so it shows no link back");
});

test('Flow replaces the old tabs, story text and diagram with the outline', () => {
  const html = renderFlowView(sample, base);
  assert.match(html, /<ul class="o-legend" aria-label="Legend">.*<li><span class="o-rel">blocks<\/span> GitHub's blocking link<\/li>/);
  assert.ok(!/data-flow-tab|class="story"|class="frow"/.test(html));
  assert.match(html, /<details class="platform o-loose" id="flow-loose"><summary>\d+ items with no recorded relationships<\/summary>/);
  assert.match(renderFlowView(sample, { ...base, ui: { ...DEFAULT_UI, toggled: { 'flow-loose': true } } }), /id="flow-loose" open>/);
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
  assert.match(acting, new RegExp(`data-queue="${second}"[^>]*>Queue</button>.*?<span class="action-error"><span role="alert">Could not set Queued.</span> <button type="button" class="dismiss" data-dismiss="action:${second}" aria-label="Dismiss error for #114">&#215;</button></span></li>`),
    'an error stays on its card with a close button');
});

test('Abandon appears only on List rows, next to Queue, and shows the delete in flight', () => {
  const html = renderBoardView(sample, base);
  assert.deepEqual(buttons(html, 'data-abandon').sort(), ids('List').sort());
  assert.match(html, /data-queue="PVTI_sample01"[^>]*>Queue<\/button><button[^>]*data-abandon="PVTI_sample01"[^>]*aria-label="Abandon #61 [^"]*"[^>]*>Abandon<\/button>/);
  const acting = renderBoardView(sample, { ...base, actions: {
    PVTI_sample01: { phase: 'pending', kind: 'abandon' },
    PVTI_sample02: { phase: 'error', kind: 'abandon', message: 'Could not delete #114. Must have admin rights.' } } });
  assert.match(acting, /data-queue="PVTI_sample01"[^>]*aria-disabled="true"[^>]*>Queue<\/button>/);
  assert.match(acting, /data-abandon="PVTI_sample01"[^>]*aria-disabled="true"[^>]*>Abandoning…<\/button>/);
  assert.match(acting, /data-queue="PVTI_sample02".*?<span class="action-error"><span role="alert">Could not delete #114\. Must have admin rights\.<\/span> <button[^>]*data-dismiss="action:PVTI_sample02"[^>]*>&#215;<\/button><\/span><\/li>/);
});

test('Abandon names the item it will delete or remove, and announces it without a link', () => {
  const issue = sample.items.find((i) => i.id === 'PVTI_sample01')!;
  const draft = sample.items.find((i) => i.id === 'PVTI_sample04')!;
  assert.equal(abandonPrompt(issue).question, `Delete #61 ${issue.title}?`);
  assert.equal(abandonPrompt(draft).question, `Remove draft ${draft.title}?`);
  const html = renderApp(sample, { ...base, notice: { key: 'notice-1', verb: 'Abandoned', item: issue } });
  assert.match(html, new RegExp(`<div class="banner toast" role="status" data-expires="notice-1"><button[^>]*data-dismiss="notice-1"[^>]*>&#215;</button>Deleted #61 ${issue.title}\\.</div>`));
  assert.match(renderPage(sample, base), /<dialog id="abandon-dialog"[^>]*>[\s\S]*data-abandon-cancel autofocus>Cancel<\/button>/);
});

test('a queued or added item is announced in a toast that offers View item', () => {
  const item = sample.items[0]!;
  for (const verb of ['Moved', 'Added'] as const) {
    const html = renderApp(sample, { ...base, notice: { key: 'notice-2', verb, item, to: 'Queued' } });
    assert.match(html, new RegExp(`<div class="toasts">\\n<div class="banner toast" role="status" data-expires="notice-2"><button[^>]*data-dismiss="notice-2"[^>]*>&#215;</button>${verb} <a[^>]*>.*</a> to Queued\\. <button type="button" class="copy view-item" data-view-item="${item.id}">View item</button></div>`));
  }
});

test('failures and the lost server have a close button; ongoing warnings do not', () => {
  const html = renderHeader({ ...sample, error: 'gh: HTTP 502' }, { ...base, clientError: 'HTTP 500' });
  assert.match(html, /role="alert"><button type="button" class="dismiss" data-dismiss="client-error" aria-label="Dismiss: can&#39;t reach the board server">&#215;<\/button><strong>Can't reach the board server/);
  assert.match(html, /role="alert"><strong>Stale\.<\/strong>/, 'stale data stays while it lasts');
  assert.ok(!renderHeader(sample, { ...base, clientError: 'HTTP 500', dismissed: new Set(['client-error']) }).includes("Can't reach"));
});

test('Start appears only on Queued issues; a queued draft asks for an issue first', () => {
  const html = renderBoardView(sample, base);
  const issues = sample.items.filter((i) => i.status === 'Queued' && i.number !== null).map((i) => i.id);
  assert.deepEqual(buttons(html, 'data-start').sort(), issues.sort());
  const draftCard = html.split('<article').find((c) => c.includes('Offline downloads on watchOS'))!;
  assert.match(draftCard, /needs an issue/);
  assert.ok(!draftCard.includes('data-start') && !draftCard.includes('data-copy'));
});

test('a Queued issue copies its work message from an icon left of Start, with no command box under the card', () => {
  const card = renderBoardView(sample, base).split('<article').find((c) => c.includes('data-start="PVTI_sample05"'))!;
  assert.ok(!card.includes('class="cmd"'), 'no command box under the card');
  const meta = card.match(/<div class="meta">.*?<\/div>/s)![0];
  assert.match(
    meta,
    /<button type="button" class="copy copy-icon" data-copy="#129 Run more than one 4K HDR to 1080p stream at a time\n\$mux-work maddec01\/[^"]+#129" data-label="Copy work message for #129" aria-label="Copy work message for #129" title="Copy work message for #129"><svg [^>]*aria-hidden="true"[^>]*>.*<\/svg><\/button><button type="button" class="copy start-item"[^>]*>Start<\/button><\/span>/s,
    'the icon sits immediately left of Start',
  );
  assert.match(meta, /<span class="start-group"><button type="button" class="copy copy-icon"/, 'the icon and Start wrap together as one group');
  const started = renderBoardView(sample, { ...base, actions: { PVTI_sample05: { phase: 'started', thread: { threadId: 't', title: 'x' } } } })
    .split('<article')
    .find((c) => c.includes('data-start-result="PVTI_sample05"'))!;
  assert.match(started, /class="copy copy-icon"[^>]*>.*<\/button><span class="started-tag"/s, 'the icon stays once Start is done');
  const error = renderBoardView(sample, { ...base, actions: { PVTI_sample05: { phase: 'error', message: 'T3 is not running' } } })
    .split('<article')
    .find((c) => c.includes('data-start="PVTI_sample05"'))!;
  assert.match(error, /<p class="start">.*T3 is not running/s, 'the Start error still shows under the card');
});

test('Start shows its progress, the started thread, or the error', () => {
  const [a, b, c, d] = ['PVTI_sample05', 'PVTI_sample06', 'PVTI_sample05', 'PVTI_sample06'];
  const card = (actions: Record<string, ItemAction>, id: string) =>
    renderBoardView(sample, { ...base, actions }).split('<article').find((x) => x.includes(`href="${sample.items.find((i) => i.id === id)!.url}"`))!;
  assert.match(card({ [a]: { phase: 'pending' } }, a), /data-start="PVTI_sample05"[^>]*aria-disabled="true"[^>]*>Starting…</);
  const thread = { threadId: 'thread-1', title: '#20 Player controls stay visible after scrubbing <on tvOS>' };
  const started = card({ [b]: { phase: 'started', thread } }, b);
  assert.match(started, /<span class="started-tag" tabindex="-1" data-start-result="PVTI_sample06" title="T3 thread thread-1">Started<\/span>/, 'the card keeps only a quiet tag');
  assert.ok(!started.includes('data-start="') && !started.includes('Started T3 thread'));
  const item = sample.items.find((i) => i.id === b)!;
  assert.match(renderHeader(sample, { ...base, notice: { key: 'notice-3', verb: 'Started', item, thread } }),
    /<div class="banner toast" role="status" data-expires="notice-3"><button[^>]*>&#215;<\/button>Started T3 thread <code class="thread-id">thread-1<\/code> for <a[^>]*>.*Player controls stay visible after scrub[^<]*<\/a>\.<\/div>/,
    'the toast says so, without repeating a title that is just the work message title');
  assert.match(renderHeader(sample, { ...base, notice: { key: 'notice-3', verb: 'Started', item, thread: { ...thread, title: 'Renamed' } } }),
    /Started T3 thread <b>Renamed<\/b> <code class="thread-id">thread-1<\/code>/, 'a title T3 chose differently is shown');
  const failed = card({ [c]: { phase: 'error', message: 'T3 is down.' } }, c);
  assert.match(failed, /<div class="meta">.*<button[^>]*data-start[^>]*>Retry start<\/button><\/span><\/div>/s, 'Start sits in the top row');
  assert.match(failed, /role="alert">T3 is down.<\/span> <button[^>]*data-dismiss="action:PVTI_sample05"/);
  const unsure = card({ [d]: { phase: 'uncertain', message: 'Check T3.' } }, d);
  assert.match(unsure, /role="alert">Check T3.<\/span> <button[^>]*data-dismiss="action:PVTI_sample06"/);
  const closed = card({ [d]: { phase: 'uncertain' } }, d);
  assert.ok(!closed.includes('Check T3.') && !closed.includes('data-start="'), 'closing an unconfirmed start hides the message and keeps Start hidden');
  assert.match(closed, /<span class="started-tag unsure" tabindex="-1" data-start-result="PVTI_sample06" title="Check T3 before starting it again">May have started<\/span>/, 'and says why');
  assert.ok(!unsure.includes('data-start="'));
});

test('copy describes the Queue and Start buttons instead of dragging or typing /mux-work', () => {
  const html = renderBoardView({ ...sample, items: [] }, base) + renderFlowView(sample, base);
  assert.ok(!/drag|in a new T3 thread/i.test(html));
  assert.match(html, /Nothing queued\. Press Queue on a List item/);
});

test('a thread another page started shows on every page, and sample mode disables every write button', () => {
  const started = renderBoardView({ ...sample, started: { PVTI_sample05: { threadId: 'thread-9', title: 'Shape the playback queue' } } }, base);
  assert.match(started, /data-start-result="PVTI_sample05" title="T3 thread thread-9">Started</);
  assert.ok(!started.includes('data-start="PVTI_sample05"'));
  const off = renderBoardView({ ...sample, capture: { session: 's', enabled: false } }, base);
  const writes = [...off.matchAll(/<button[^>]*data-(?:queue|start|abandon)="[^"]*"[^>]*>/g)];
  assert.ok(writes.some((m) => m[0].includes('data-abandon')));
  assert.ok(writes.every((m) => m[0].includes(' disabled')));
});

test("a linked PR shows its checks: running with counts and age, amber when slow, passed, failed, or nothing", () => {
  const pr = { number: 9, url: 'https://github.com/maddec01/mux-server/pull/9', state: 'OPEN', isDraft: false };
  const item = { ...sample.items[0]!, status: 'Review' as const, linkedPrs: [
    { ...pr, checks: { passed: 3, failed: 0, running: 2, total: 5, since: '2026-10-21T09:48:00Z' } },
    { ...pr, number: 10, checks: { passed: 1, failed: 0, running: 1, total: 2, since: '2026-10-21T09:00:00Z' } },
    { ...pr, number: 11, checks: { passed: 5, failed: 0, running: 0, total: 5, since: '2026-10-21T09:00:00Z' } },
    { ...pr, number: 12, checks: { passed: 4, failed: 1, running: 0, total: 5, since: '2026-10-21T09:00:00Z' } },
    { ...pr, number: 13, checks: null },
    { ...pr, number: 14, state: 'CLOSED', checks: { passed: 0, failed: 1, running: 0, total: 1, since: null } },
  ] };
  const html = renderBoardView({ ...sample, items: [item] }, base);
  assert.match(html, /PR #9<\/a><span class="checks running" title="Checks running: 3 of 5 passed, 2 running">checks 3\/5 · 12m<\/span>/);
  assert.match(html, /PR #10<\/a><span class="checks running slow" title="Checks running for over 30 minutes: 1 of 2 passed, 1 running">checks 1\/2 · 1h 0m<span class="sr-only"> \(running over 30 minutes\)<\/span><\/span>/);
  assert.match(html, /PR #11<\/a><span class="checks passed" title="All 5 checks passed">checks passed<\/span>/);
  assert.match(html, /PR #12<\/a><span class="checks failed" title="1 of 5 checks failed">checks failed<\/span>/);
  assert.match(html, /PR #13<\/a>(?!<span class="checks)/);
  assert.match(html, /PR #14 \(closed\)<\/a>(?!<span class="checks)/, 'only open PRs show checks');
});
