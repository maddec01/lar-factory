// Saved-copy test: renders test/sample.json and compares it with test/expected/.
// Run `pnpm run test:update` to rewrite the saved copies after a deliberate change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { renderPage } from '../src/page.ts';
import { DEFAULT_UI } from '../src/ui-state.ts';
import { formatTokens, formatUsd } from '../src/format.ts';
import { abandonPrompt, answeredRecheck, recheckAnswer, renderAbandonDialog, renderApp, renderBoardView, renderHeader } from '../src/render.ts';
import type { ItemAction, RenderOptions } from '../src/render.ts';
import type { BoardData, ModelGroup } from '../src/model.ts';
import { normalizeItems } from '../src/github.ts';
import type { RawItem } from '../src/github.ts';
import { rawIssue, sliceRef } from './raw-items.ts';

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

test('code updates have a copyable command and a warning independent of project staleness', () => {
  const data: BoardData = { ...sample, fetchedAt: new Date(base.now).toISOString(), error: null, codeUpdate: {
    runningRevision: 'a'.repeat(40), remoteRevision: 'b'.repeat(40), behind: 2, error: null,
    command: "bash '/Users/pedro/Developer/Mux/mux-factory/board/scripts/update.sh'", updatable: false,
    logs: { update: '/Users/pedro/Library/Logs/mux-board-update.log', board: '/Users/pedro/Library/Logs/mux-board.log' },
  } };
  const html = renderApp(data, base);
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

const builtIssue = rawIssue('PVTI_build', 59, 'In progress', ['improvement', 'build'], {
  subIssuesSummary: { total: 3, completed: 1 },
  subIssues: { nodes: [sliceRef(65, 'CLOSED'), sliceRef(66, 'OPEN'), sliceRef(67, 'OPEN')] },
});
const boardOf = (raws: RawItem[], builds = new Set<string>()): BoardData => ({ ...sample, error: null, items: normalizeItems(raws, { builds }) });

/** A build card's popover: the trigger's opening tag, the popover's id, and each row's state, number and link in order. */
function slicePopover(card: string) {
  const trigger = /<div class="slices-trigger"[^>]*>/.exec(card)?.[0];
  const pop = /<div class="slices-pop" id="([^"]+)">(.*?)<\/div>/s.exec(card);
  assert.ok(trigger && pop, 'the card has a slice popover and its trigger');
  const rows = [...pop[2]!.matchAll(/<li class="row-item slice-row ([a-z]+)">.*?<a [^>]*href="([^"]+)"[^>]*><span class="ref">#(\d+)<\/span>/g)];
  return { trigger, id: pop[1], rows: rows.map((m) => [m[1], Number(m[3]), m[2]]) };
}

test("a build's popover stays open across a re-render", () => {
  const data = boardOf([builtIssue]);
  const card = (slicesOpen?: string) => renderBoardView(data, { ...base, ui: { ...DEFAULT_UI, slicesOpen } })
    .split('<article').find((a) => a.includes('data-anchor="PVTI_build"'))!;
  assert.match(slicePopover(card('PVTI_build')).trigger, /aria-expanded="true"/);
  assert.match(card('PVTI_build'), /<div class="slices open" data-slices="PVTI_build">/);
  assert.match(slicePopover(card('PVTI_other')).trigger, /aria-expanded="false"/);
  assert.match(card(), /<div class="slices" data-slices="PVTI_build">/);
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

test('Queue shows the action in flight or its error', () => {
  const [first, second] = ids('List') as [string, string];
  const acting = renderBoardView(sample, { ...base, actions: {
    [first]: { phase: 'pending' }, [second]: { phase: 'error', message: 'Could not set Queued.' } } });
  assert.match(acting, new RegExp(`data-queue="${first}"[^>]*aria-disabled="true"[^>]*>Queuing…</button>`));
  assert.match(acting, new RegExp(`data-queue="${second}"[^>]*>Queue</button>.*?<span class="action-error"><span role="alert">Could not set Queued.</span> <button type="button" class="dismiss" data-dismiss="action:${second}" aria-label="Dismiss error for #114">&#215;</button></span></li>`),
    'an error stays on its card with a close button');
});

test('Abandon shows the delete in flight', () => {
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
  assert.match(renderAbandonDialog(), /<dialog id="abandon-dialog"[^>]*>[\s\S]*data-abandon-cancel autofocus>Cancel<\/button>/);
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

test('Started replaces Start in its group, and a Start error shows under the card', () => {
  const started = renderBoardView(sample, { ...base, actions: { PVTI_sample05: { phase: 'started', thread: { threadId: 't', title: 'x' } } } })
    .split('<article')
    .find((c) => c.includes('data-start-result="PVTI_sample05"'))!;
  assert.match(started, /<span class="start-group"><span class="started-tag"/, 'Started replaces Start in the group');
  const error = renderBoardView(sample, { ...base, actions: { PVTI_sample05: { phase: 'error', message: 'T3 is not running' } } })
    .split('<article')
    .find((c) => c.includes('data-start="PVTI_sample05"'))!;
  assert.match(error, /<p class="start">.*T3 is not running/s, 'the Start error still shows under the card');
});

const cardOf = (html: string, id: string) => html.split('<article').find((c) => c.includes(`data-anchor="${id}"`))!;

test('Back to List, Abandon and Start each show only their own pending state', () => {
  const card = (action: ItemAction) => cardOf(renderBoardView(sample, { ...base, actions: { PVTI_sample05: action } }), 'PVTI_sample05');
  const moving = card({ phase: 'pending', kind: 'back-to-list' });
  assert.match(moving, /data-back-to-list="PVTI_sample05" aria-label="Moving #129 [^"]*" aria-disabled="true">\u2190 Moving to List…<\/button>/);
  assert.match(moving, /data-start="PVTI_sample05"[^>]*>Start \u25be<\/button>/, 'Start is not relabelled');
  assert.match(card({ phase: 'pending' }), />Starting…<\/button>/);
  const abandoning = card({ phase: 'pending', kind: 'abandon' });
  assert.match(abandoning, /data-back-to-list="PVTI_sample05" aria-label="Back to List #129 [^"]*" aria-disabled="true">\u2190 Back to List<\/button><button[^>]*data-abandon="PVTI_sample05" aria-label="Abandoning… #129 [^"]*" aria-disabled="true">Abandoning…<\/button>/);
  assert.match(abandoning, /data-start="PVTI_sample05"[^>]*>Start \u25be<\/button>/, 'Start is not relabelled');
  assert.match(moving, /data-abandon="PVTI_sample05"[^>]*>Abandon<\/button>/, 'Abandon is not relabelled by Back to List');
  const otherError = card({ phase: 'error', kind: 'abandon', message: 'Could not delete #129.' });
  assert.match(otherError, /data-start="PVTI_sample05"[^>]*>Start \u25be<\/button>/, 'another action\'s error is not a Start error');
  assert.ok(!otherError.includes('<p class="start">') && !otherError.includes('action-error'), 'a card shows no inline error');
});

test('a Queued card whose Start is pending, uncertain or done shows no footer actions', () => {
  const card = (data: typeof sample, action?: ItemAction) =>
    cardOf(renderBoardView(data, { ...base, actions: action ? { PVTI_sample05: action } : {} }), 'PVTI_sample05');
  const thread = { threadId: 'thread-1', title: 'Shape it' };
  for (const [why, html] of [
    ['pending', card(sample, { phase: 'pending' })],
    ['uncertain', card(sample, { phase: 'uncertain', message: 'Check T3.' })],
    ['uncertain, message closed', card(sample, { phase: 'uncertain' })],
    ['started on this page', card(sample, { phase: 'started', thread })],
    ['started on another page', card({ ...sample, started: { PVTI_sample05: thread } })],
  ] as const) assert.ok(!html.includes('card-actions'), `no footer while Start is ${why}`);
  assert.match(card(sample, { phase: 'error', message: 'T3 is down.' }), /<div class="card-actions">/, 'a failed Start brings the footer back');
});

test('a failed card action shows as a toast naming the item, which stays until closed', () => {
  const item = sample.items.find((i) => i.id === 'PVTI_sample05')!;
  const html = renderApp(sample, { ...base, notice: { key: 'notice-3', verb: 'Failed', item, to: 'List', message: 'Could not set List. GitHub is down.' } });
  assert.match(html, /<div class="banner toast" role="alert"><button[^>]*data-dismiss="notice-3"[^>]*>&#215;<\/button>Couldn't move <a[^>]*>.*<\/a> to List\. Could not set List\. GitHub is down\.<\/div>/);
  const abandon = renderApp(sample, { ...base, notice: { key: 'notice-4', verb: 'Failed', item, message: 'Could not delete #129.' } });
  assert.match(abandon, /<div class="banner toast" role="alert"><button[^>]*data-dismiss="notice-4"[^>]*>&#215;<\/button>Couldn't abandon <a[^>]*>.*<\/a>\. Could not delete #129\.<\/div>/);
});

const MODEL_CHOICES: ModelGroup[] = [
  { instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] },
  { instanceId: 'claudeAgent', name: 'VI <work>', models: [{ slug: 'claude-opus-5-5', label: 'Opus 5.5' }, { slug: 'claude-opus-5-5[1m]', label: 'claude-opus-5-5[1m]' }] },
];

test("a Queued card's Start opens a menu: 'T3 default' first, then each provider instance with its models", () => {
  const data = { ...sample, modelChoices: MODEL_CHOICES };
  const cardOf = (html: string, id: string) => html.split('<article').find((c) => c.includes(`data-start="${id}"`))!;
  const closed = cardOf(renderBoardView(data, base), 'PVTI_sample05');
  assert.match(closed, /<button type="button" class="copy start-item" data-start="PVTI_sample05" aria-label="Start [^"]*" aria-haspopup="menu" aria-expanded="false">Start \u25be<\/button>/);
  assert.ok(!closed.includes('role="menu"'));
  const html = renderBoardView(data, { ...base, ui: { ...DEFAULT_UI, startMenuOpen: 'PVTI_sample05' } });
  const open = cardOf(html, 'PVTI_sample05');
  assert.match(open, /data-start="PVTI_sample05"[^>]*aria-expanded="true"/);
  const menu = open.match(/<div class="start-menu" role="menu"[^>]*>.*?<\/div>/s)![0];
  const entries = [...menu.matchAll(/<button type="button" role="menuitemradio" aria-checked="(true|false)"[^>]*data-start-pick="PVTI_sample05"([^>]*)>([^<]*)</g)]
    .map(([, checked, attrs, label]) => [label, checked, attrs!.trim()]);
  assert.deepEqual(entries, [
    ['T3 default', 'true', ''],
    ['GPT-5.5', 'false', 'data-instance-id="codex" data-model="gpt-5.5"'],
    ['Opus 5.5', 'false', 'data-instance-id="claudeAgent" data-model="claude-opus-5-5"'],
    ['claude-opus-5-5[1m]', 'false', 'data-instance-id="claudeAgent" data-model="claude-opus-5-5[1m]"'],
  ], '"T3 default" is the highlighted entry');
  assert.deepEqual([...menu.matchAll(/<ul role="group" aria-label="([^"]*)"/g)].map((m) => m[1]), ['Codex', 'VI &lt;work&gt;'], 'grouped by instance, by its name');
  assert.ok(!cardOf(html, 'PVTI_sample06').includes('role="menu"'), 'only the card whose menu is open shows it');
  assert.equal(renderBoardView(data, { ...base, ui: { ...DEFAULT_UI, startMenuOpen: 'PVTI_sample05' }, actions: { PVTI_sample05: { phase: 'pending' } } }).includes('role="menu"'), false,
    'no menu while a start is in flight');
});

test('the menu highlights the remembered model choice while it is offered, else "T3 default"', () => {
  const data = { ...sample, modelChoices: MODEL_CHOICES };
  const checked = (lastChoice: { instanceId: string; model: string }) =>
    [...renderBoardView(data, { ...base, ui: { ...DEFAULT_UI, startMenuOpen: 'PVTI_sample05', lastChoice } })
      .matchAll(/aria-checked="true"[^>]*>([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(checked({ instanceId: 'claudeAgent', model: 'claude-opus-5-5[1m]' }), ['claude-opus-5-5[1m]']);
  assert.deepEqual(checked({ instanceId: 'claudeAgent', model: 'gpt-5.5' }), ['T3 default'], 'not offered on that instance');
});

test('without model choices, the menu offers only "T3 default"', () => {
  const html = renderBoardView(sample, { ...base, ui: { ...DEFAULT_UI, startMenuOpen: 'PVTI_sample05' } });
  assert.deepEqual([...html.matchAll(/data-start-pick="[^"]*"[^>]*>([^<]*)</g)].map((m) => m[1]), ['T3 default']);
  assert.ok(!html.includes('role="group"'));
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
  assert.match(failed, /<div class="meta">.*<button[^>]*data-start[^>]*>Retry start \u25be<\/button><\/span><\/div>/s, 'Start sits in the top row');
  assert.match(failed, /role="alert">T3 is down.<\/span> <button[^>]*data-dismiss="action:PVTI_sample05"/);
  const unsure = card({ [d]: { phase: 'uncertain', message: 'Check T3.' } }, d);
  assert.match(unsure, /role="alert">Check T3.<\/span> <button[^>]*data-dismiss="action:PVTI_sample06"/);
  const closed = card({ [d]: { phase: 'uncertain' } }, d);
  assert.ok(!closed.includes('Check T3.') && !closed.includes('data-start="'), 'closing an unconfirmed start hides the message and keeps Start hidden');
  assert.match(closed, /<span class="started-tag unsure" tabindex="-1" data-start-result="PVTI_sample06" title="Check T3 before starting it again">May have started<\/span>/, 'and says why');
  assert.ok(!unsure.includes('data-start="'));
});

test('in sample mode, Start still opens its menu, and no entry in it starts anything', () => {
  // Start still opens its menu, so sample mode shows the model choices; no entry in it starts anything.
  const menu = renderBoardView({ ...sample, capture: { session: 's', enabled: false }, modelChoices: MODEL_CHOICES }, { ...base, ui: { ...DEFAULT_UI, startMenuOpen: 'PVTI_sample05' } });
  const picks = [...menu.matchAll(/<button[^>]*data-start-pick="[^"]*"[^>]*>/g)];
  assert.ok(picks.length > 1);
  assert.ok(picks.every((m) => m[0].includes('aria-disabled="true"') && m[0].includes('title="Disabled in sample mode"')));
});

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
