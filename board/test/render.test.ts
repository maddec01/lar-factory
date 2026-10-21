// Saved-copy test: renders test/sample.json and compares it with test/expected/.
// Run `pnpm run test:update` to rewrite the saved copies after a deliberate change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { renderPage } from '../src/page.ts';
import { DEFAULT_UI, abandonPrompt, renderAddItemForm, renderApp, renderBoardView, renderFlowView, renderHeader } from '../src/render.ts';
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
  assert.equal(actual, expected, `${name} differs from the saved copy; run pnpm run test:update if intended`);
}

test('page: header, stale banner and both views', () => {
  matchesSaved('page.html', renderPage(sample, base));
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
  assert.match(done, /Update finished.<\/strong> The board now runs <code>bbbbbbb<\/code>/);
  const skipped = renderHeader({ ...data, update: { ...progress, state: 'done', current: null,
    finished: ['check', 'fetch', 'skills', 'profiles', 'done'], finishedAt: '2026-10-21T09:59:50Z' } }, base);
  assert.match(skipped, /already current/);
  const old = renderHeader({ ...failed, update: { ...failed.update!, finishedAt: '2026-10-21T09:00:00Z' } }, base);
  assert.ok(!old.includes('Update failed'), 'an old result leaves the header');
  const lost = renderHeader(data, { ...base, updateView: { phase: 'lost' } });
  matchesSaved('update-lost.html', lost);
  assert.match(lost, /The board didn't restart/);
  assert.match(lost, /mux-board\.log/);
  assert.match(lost, /board\/scripts\/update\.sh/);
  const refused = renderHeader(data, { ...base, updateView: { phase: 'refused', message: 'A Start is running. Press Update when it finishes.' } });
  assert.match(refused, /role="alert"><strong>The update didn't start.<\/strong> A Start is running/);
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
    return html.split('<li class="row-item">').find((r) => r.includes(`${item.title}</`))!;
  };
  const pills = (row: string) => [...row.matchAll(/<span class="label kind-[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);
  assert.deepEqual(pills(rowOf('PVTI_sample03')), ['feature', 'app: music', 'os: ios', 'os: macos']);
  assert.deepEqual(pills(rowOf('PVTI_sample19')), ['bug', 'os: watchos'], 'Done rows too');
  assert.deepEqual(pills(rowOf('PVTI_sample04')), [], 'a draft has no labels');
  for (const id of ['PVTI_sample03', 'PVTI_sample19']) assert.ok(!rowOf(id).includes('class="kind'), 'no separate kind pill');
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

test('Abandon appears only on List rows, next to Queue, and shows the delete in flight', () => {
  const html = renderBoardView(sample, base);
  assert.deepEqual(buttons(html, 'data-abandon').sort(), ids('List').sort());
  assert.match(html, /data-queue="PVTI_sample01"[^>]*>Queue<\/button><button[^>]*data-abandon="PVTI_sample01"[^>]*aria-label="Abandon #61 [^"]*"[^>]*>Abandon<\/button>/);
  const acting = renderBoardView(sample, { ...base, actions: {
    PVTI_sample01: { phase: 'pending', kind: 'abandon' },
    PVTI_sample02: { phase: 'error', kind: 'abandon', message: 'Could not delete #114. Must have admin rights.' } } });
  assert.match(acting, /data-queue="PVTI_sample01"[^>]*aria-disabled="true"[^>]*>Queue<\/button>/);
  assert.match(acting, /data-abandon="PVTI_sample01"[^>]*aria-disabled="true"[^>]*>Abandoning…<\/button>/);
  assert.match(acting, /role="alert">Could not delete #114\. Must have admin rights\.<\/span><button[^>]*data-queue="PVTI_sample02"/);
});

test('Abandon names the item it will delete or remove, and announces it without a link', () => {
  const issue = sample.items.find((i) => i.id === 'PVTI_sample01')!;
  const draft = sample.items.find((i) => i.id === 'PVTI_sample04')!;
  assert.equal(abandonPrompt(issue).question, `Delete #61 ${issue.title}?`);
  assert.equal(abandonPrompt(draft).question, `Remove draft ${draft.title}?`);
  const html = renderApp(sample, { ...base, notice: { verb: 'Abandoned', item: issue } });
  assert.match(html, new RegExp(`role="status">Deleted #61 ${issue.title}\\.</div>`));
  assert.match(renderPage(sample, base), /<dialog id="abandon-dialog"[^>]*>[\s\S]*data-abandon-cancel autofocus>Cancel<\/button>/);
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

test('a thread another page started shows on every page, and sample mode disables every write button', () => {
  const started = renderBoardView({ ...sample, started: { PVTI_sample05: { threadId: 'thread-9', title: 'Shape the playback queue' } } }, base);
  assert.match(started, /Started T3 thread <b>Shape the playback queue<\/b> <code class="thread-id">thread-9<\/code>/);
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
