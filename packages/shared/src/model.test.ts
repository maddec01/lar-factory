import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blockedText, blockerRef, buildBranch, buildMessage, canAbandon, carriesTwoStatuses, checkState, failedCheck, ghBlocksRead, itemSource, isBuild, itemPr, itemTotal, isRecentlyDone, isSlow, isStale, keepOneText, kindOf, labelStatuses, openBlockers, repositoryProjectHint, sliceProgress, statusLabel, threadLink, workMessage, workTitle } from './model.ts';
import type { BoardData, Checks, Item, Status } from './model.ts';
import { boardSections } from './board-view.ts';
import { formatTokens, formatUsd, shortAgo } from './format.ts';

function item(status: Status, labels: string[] = [], extra: Partial<Item> = {}): Item {
  return {
    id: 'x',
    status,
    statuses: status === 'Done' ? [] : [status],
    content: 'ticket',
    number: 7,
    title: 't',
    url: 'https://github.com/maddec01/lar-server/issues/7',
    repo: 'maddec01/lar-server',
    labels,
    state: 'open',
    closedAs: null,
    parent: null,
    subIssues: { total: 0, completed: 0 },
    blockers: [],
    updatedAt: '2026-10-21T09:00:00Z',
    closedAt: null,
    linkedPrs: [],
    slices: [],
    ...extra,
  };
}

test('a slice is done once closed as completed, blocked or active while open with that label, else waiting; not planned is hidden', () => {
  const active = { active: true };
  const blocked = { blocked: true };
  assert.equal(sliceProgress('CLOSED', 'COMPLETED', {}), 'done');
  assert.equal(sliceProgress('CLOSED', 'COMPLETED', active), 'done', 'a closed slice is done even if it still has active');
  assert.equal(sliceProgress('CLOSED', 'COMPLETED', blocked), 'done', 'a closed slice is done even if it still has blocked');
  assert.equal(sliceProgress('CLOSED', null, {}), 'done', 'closed before GitHub kept a reason');
  assert.equal(sliceProgress('OPEN', null, active), 'active');
  assert.equal(sliceProgress('OPEN', null, blocked), 'blocked');
  assert.equal(sliceProgress('OPEN', null, { active: true, blocked: true }), 'blocked', 'blocked wins over active');
  assert.equal(sliceProgress('OPEN', 'REOPENED', {}), 'waiting');
  assert.equal(sliceProgress('CLOSED', 'NOT_PLANNED', {}), null);
  assert.equal(sliceProgress('CLOSED', 'NOT_PLANNED', blocked), null);
  assert.equal(sliceProgress('CLOSED', 'DUPLICATE', {}), null, 'a duplicate is closed as not planned too');
});

test('kinds come from labels', () => {
  assert.equal(kindOf(item('List', ['bug', 'concept'])), 'concept');
  assert.equal(kindOf(item('List', [], { repo: null, number: null })), 'draft');
  assert.equal(kindOf(item('List', [])), 'issue');
  assert.equal(kindOf(item('List', ['improvement', 'build'])), 'improvement', 'build only switches on slices');
  assert.equal(kindOf(item('List', ['build', 'bug'])), 'bug');
  assert.equal(kindOf(item('List', ['build', 'feature'])), 'feature');
  assert.equal(kindOf(item('List', ['build'])), 'build', 'with no other kind it reads as a build');
  assert.equal(kindOf(item('List', ['build', 'decision: research'])), 'decision');
});

test('the build label makes a build whatever the kind, except on a concept', () => {
  assert.equal(isBuild(item('List', ['build'])), true);
  assert.equal(isBuild(item('List', ['build', 'feature'])), true);
  assert.equal(isBuild(item('List', ['feature'])), false);
  assert.equal(isBuild(item('List', ['build', 'concept'])), false, "a concept's sub-issues are board items, not slices");
});

test("an item's open blockers are the blocked-by issues still open", () => {
  const blockers = [{ number: 3, repo: 'maddec01/lar-server', state: 'closed' as const }, { number: 4, repo: 'maddec01/lar-apple', state: 'open' as const }];
  assert.deepEqual(openBlockers(item('Ready', [], { blockers })), [blockers[1]]);
});

test('the blocked text names the open blockers, with the repository when it is another', () => {
  const blocker = (number: number, repo: string, state: 'open' | 'closed') => ({ number, repo, state });
  assert.equal(blockedText(item('Ready', [], { blockers: [blocker(3, 'maddec01/lar-server', 'open')] })), 'Blocked by #3 until it closes');
  assert.equal(blockedText(item('Ready', [], { blockers: [blocker(3, 'maddec01/lar-server', 'open'), blocker(4, 'maddec01/lar-apple', 'open')] })),
    'Blocked by #3, maddec01/lar-apple#4 until they close');
  assert.equal(blockedText(item('Ready', [], { blockers: [blocker(3, 'maddec01/lar-server', 'closed')] })), null);
});

test("a blocker's ref is #n for the item's repository, and names another repository in full, or without its owner when short", () => {
  const own = item('Ready', []);
  assert.deepEqual([blockerRef(own, { number: 3, repo: own.repo! }), blockerRef(own, { number: 3, repo: own.repo! }, true)], ['#3', '#3']);
  assert.deepEqual([blockerRef(own, { number: 4, repo: 'maddec01/lar-apple' }), blockerRef(own, { number: 4, repo: 'maddec01/lar-apple' }, true)],
    ['maddec01/lar-apple#4', 'lar-apple#4']);
});

test("a repository's project hint is found whatever the case, and is null once T3 has its project or before any read", () => {
  const repositoryProjects = { 'maddec01/lar-server': 'Add the checkout in T3 Code', 'maddec01/lar-factory': null };
  assert.equal(repositoryProjectHint({ repositoryProjects }, 'MADDEC01/Lar-Server'), 'Add the checkout in T3 Code');
  assert.equal(repositoryProjectHint({ repositoryProjects }, 'maddec01/lar-factory'), null);
  assert.equal(repositoryProjectHint({}, 'maddec01/lar-server'), null);
});

test('Done counts for 7 days after closing', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  assert.equal(isRecentlyDone(item('Done', [], { closedAt: '2026-10-15T10:00:00Z' }), now), true);
  assert.equal(isRecentlyDone(item('Done', [], { closedAt: '2026-10-13T10:00:00Z' }), now), false);
  assert.equal(isRecentlyDone(item('Review', [], { closedAt: '2026-10-21T09:00:00Z' }), now), false);
});

test('the work message titles the thread, then runs lar-work on the issue', () => {
  assert.equal(workMessage(item('Queued')), '#7 t\n$lar-work maddec01/lar-server#7');
  assert.equal(workTitle(item('Queued')), '#7 t');
  const draft = item('Queued', [], { repo: null, number: null });
  assert.equal(workMessage(draft), null);
  assert.equal(workTitle(draft), null);
});

test('a $word in the title is kept and $lar-work still opens line 2', () => {
  const message = workMessage(item('Queued', [], { title: 'Fix $foo parsing' }))!;
  assert.equal(message, '#7 Fix $foo parsing\n$lar-work maddec01/lar-server#7');
  assert.equal(message.split('\n')[1], '$lar-work maddec01/lar-server#7');
});

test('a build branch is <kind>/<n>-<slug>: fix for a bug, feat for a feature or improvement, else chore', () => {
  const title = 'Add Start build to the board server';
  assert.equal(buildBranch(item('Ready', ['bug'], { title })), 'fix/7-add-start-build-to-the');
  assert.equal(buildBranch(item('Ready', ['feature'], { title })), 'feat/7-add-start-build-to-the');
  assert.equal(buildBranch(item('Ready', ['improvement', 'build'], { title })), 'feat/7-add-start-build-to-the');
  assert.equal(buildBranch(item('Ready', ['build'], { title })), 'chore/7-add-start-build-to-the');
  assert.equal(buildBranch(item('Ready', [], { title })), 'chore/7-add-start-build-to-the');
});

test('a build branch slug takes up to five words of the title, lowercase, with what a branch name cannot hold left out', () => {
  const branch = (title: string) => buildBranch(item('Ready', ['bug'], { title }));
  assert.equal(branch('Crash'), 'fix/7-crash');
  assert.equal(branch('Fix login'), 'fix/7-fix-login');
  assert.equal(branch("  Board: don't  read ~/.t3 [twice]?  "), 'fix/7-board-dont-read-t3-twice');
  assert.equal(branch('Fix `t3` CLI\'s path..lock @{ref} ^ * : \\ end'), 'fix/7-fix-t3-clis-path-lock');
  assert.equal(branch('Café crème über naïve'), 'fix/7-cafe-creme-uber-naive');
  assert.equal(branch('日本語 title 🚀 here'), 'fix/7-title-here');
  assert.equal(branch('日本語 🚀'), 'fix/7');
  assert.equal(buildBranch(item('Ready', [], { repo: null, number: null })), null);
});

test('the build message names the build and the builder agent of the installed lar-work', () => {
  assert.equal(buildMessage(item('Ready'), '/Users/me/.agents/skills/lar-work'),
    'Build maddec01/lar-server#7. Read /Users/me/.agents/skills/lar-work/agents/builder.md and follow it.');
  assert.equal(buildMessage(item('Ready', [], { repo: null, number: null }), '/x'), null);
});

test('an item total adds each sub-issue on the board once, at any depth, and is null when sub-issues add nothing', () => {
  const repo = 'maddec01/lar-server';
  const under = (n: number) => ({ number: n, title: 't', url: `https://github.com/${repo}/issues/${n}`, repo: 'Maddec01/Lar-Server', state: 'open' as const });
  const parent = item('In progress', [], { id: 'p', number: 7, stats: { agentMs: 10, wallMs: 1, tokens: 100, costUsd: 0.5 } });
  const build = item('Done', ['build'], { id: 'b', number: 8, parent: under(7), stats: { agentMs: 20, wallMs: 2, tokens: 200, costUsd: 3, frozen: true } });
  const nested = item('Done', ['build'], { id: 'n', number: 9, parent: under(8), stats: { agentMs: 40, tokens: 400, costUsd: 5, frozen: true } });
  const quiet = item('Ready', [], { id: 'q', number: 10, parent: under(7) });
  const other = item('Done', [], { id: 'o', number: 11, repo: 'maddec01/lar-apple', parent: under(7), stats: { agentMs: 1, tokens: 1 } });
  const items = [parent, build, nested, quiet, other];
  assert.deepEqual(itemTotal(parent, items), { agentMs: 71, tokens: 701, costUsd: 8.5 },
    'parent repos match in any case; wall only when every figure has it, frozen only when all are');
  assert.deepEqual(itemTotal(build, items), { agentMs: 60, tokens: 600, costUsd: 8, frozen: true });
  assert.equal(itemTotal(nested, items), null, 'no sub-issues: the total equals the item stats');
  assert.equal(itemTotal(quiet, items), null);
  assert.equal(itemTotal(parent, [parent, quiet]), null, 'sub-issues without figures add nothing');
  assert.equal(itemTotal(parent, [parent, { ...quiet, stats: { agentMs: 0, wallMs: 0, tokens: 0, costUsd: 0 } }, { ...other, stats: { agentMs: 0, tokens: 0 } }]), null,
    'sub-issues with all-zero figures leave the total equal to the item stats');
  assert.deepEqual(itemTotal(item('Queued', [], { id: 'p', number: 7 }), [build]),
    { agentMs: 20, wallMs: 2, tokens: 200, costUsd: 3, frozen: true }, 'a parent without its own figures totals its sub-issues');
  const looped = { ...parent, parent: under(8) };
  assert.deepEqual(itemTotal(looped, [looped, build, build]), { agentMs: 30, wallMs: 3, tokens: 300, costUsd: 3.5 },
    'each item counts once, even listed twice or in a loop');
  assert.equal(itemTotal(parent, [parent, { ...build, stats: 'unavailable' }]), 'unavailable', 'an unreadable figure leaves the total unknown');
  assert.equal(itemTotal({ ...parent, stats: 'unavailable' }, [build]), 'unavailable');
});

const sample = JSON.parse(readFileSync(new URL('../test/sample.json', import.meta.url), 'utf8')) as BoardData;

test('stale when the last read failed or is too old', () => {
  const fresh = { ...sample, error: null, fetchedAt: '2026-10-21T09:59:00Z' };
  assert.equal(isStale(sample, Date.parse('2026-10-21T09:41:00Z')), true);
  assert.equal(isStale(fresh, Date.parse('2026-10-21T10:00:00Z')), false);
  assert.equal(isStale(fresh, Date.parse('2026-10-21T10:30:00Z')), true);
  assert.equal(isStale({ ...sample, error: null, fetchedAt: null }, Date.parse('2026-10-21T10:30:00Z')), false, 'a first read still running is not stale');
  assert.equal(isStale({ ...sample, error: 'HTTP 502', fetchedAt: null }, Date.parse('2026-10-21T10:30:00Z')), true);
});

test('sample covers every status and both platforms', () => {
  const statuses = new Set(sample.items.map((i) => i.status));
  assert.equal(statuses.size, 10);
  const repos = new Set(sample.items.map((i) => i.repo));
  assert.ok(repos.has('maddec01/lar-server') && repos.has('maddec01/lar-apple'));
  const { needsYou, inFlight, queued, list } = boardSections(sample, Date.parse('2026-10-21T10:00:00Z'));
  assert.deepEqual([sample.items.length, needsYou.length, inFlight.length, queued.length, list.length], [28, 8, 8, 3, 4]);
});

test('the desk holds Ready, Needs you, Verify and Ready to merge, in flow order, and no concepts', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  const items = [item('Verify'), item('Ready'), item('Ready', ['concept']), item('Needs you', ['concept']), item('Ready to merge'), item('Needs you'), item('In progress')]
    .map((i, n) => ({ ...i, id: `i${n}` }));
  const { needsYou } = boardSections({ ...sample, items }, now);
  assert.deepEqual(needsYou.map((i) => i.status), ['Needs you', 'Ready', 'Verify', 'Ready to merge']);
  assert.ok(boardSections(sample, now).needsYou.some((i) => i.status === 'Ready' && i.parent), 'a build sub-issue in Ready is on the desk');
});

test('the sample has a Verify item in each merge state', () => {
  const verify = sample.items.filter((i) => i.status === 'Verify');
  assert.deepEqual(new Set(verify.map((i) => itemPr(i)?.pipeline?.mergeState)), new Set(['can merge', 'checking', 'blocked', 'conflicts']));
  assert.ok(verify.some((i) => i.content === 'pr'), 'one is itself a pull request');
  assert.ok(verify.some((i) => itemPr(i)?.pipeline && !itemPr(i)!.pipeline!.checks), 'one has no checks');
});

test('token counts are compact as on T3 Code\'s usage page', () => {
  assert.deepEqual([0, 980, 1_000, 1_234, 40_200, 312_400, 999_999, 1_200_000, 12_436_000, 2.5e9, 3e12].map(formatTokens),
    ['0', '980', '1K', '1.23K', '40.2K', '312K', '1000K', '1.20M', '12.4M', '2.50B', '3T']);
});

test('costs are shown as on T3 Code\'s usage page', () => {
  assert.deepEqual([0.004, 41.2, 1234.567].map(formatUsd), ['$0.00', '$41.20', '$1,234.57']);
});

test('a short age rounds each unit down, and a future time reads 0s ago', () => {
  const now = Date.parse('2026-10-23T12:00:00Z');
  const at = (s: number) => new Date(now - s * 1000).toISOString();
  assert.deepEqual([0, 59, 60, 59 * 60 + 59, 60 * 60, 47 * 3600 + 59 * 60, 48 * 3600, -30].map((s) => shortAgo(at(s), now)),
    ['0s ago', '59s ago', '1m ago', '59m ago', '1h ago', '47h ago', '2d ago', '0s ago']);
});

test("an item's PR is the one Open PR opens: its first linked PR, or itself when it is a pull request", () => {
  const pipeline = { checks: null, mergeState: 'blocked' as const };
  const linked = (number: number, mergeState: 'can merge' | 'conflicts') => ({ number, url: `u${number}`, state: 'open' as const, isDraft: false, checks: null, mergeState });
  assert.deepEqual(itemPr(item('Verify', [], { linkedPrs: [linked(1, 'conflicts'), linked(2, 'can merge')] })), { url: 'u1', pipeline: linked(1, 'conflicts') });
  assert.equal(itemPr(item('Verify')), null, 'no PR, no link and no pipeline');
  const pr = item('Verify', [], { content: 'pr', url: 'https://github.com/maddec01/lar-server/pull/7', pipeline, linkedPrs: [linked(1, 'conflicts')] });
  assert.deepEqual(itemPr(pr), { url: 'https://github.com/maddec01/lar-server/pull/7', pipeline });
  assert.deepEqual(itemPr({ ...pr, pipeline: undefined }), { url: 'https://github.com/maddec01/lar-server/pull/7', pipeline: null }, 'a PR whose pipeline was not read');
});

test('a running badge wins over failures until every check finishes, and turns slow after 30 minutes', () => {
  const now = Date.parse('2026-10-21T10:00:00Z');
  const checks = (c: Partial<Checks>): Checks => ({ passed: 0, failed: 0, running: 0, total: 0, since: null, ...c });
  assert.equal(checkState(checks({ passed: 1, running: 1, failed: 1, total: 3 })), 'running');
  assert.equal(checkState(checks({ passed: 2, failed: 1, total: 3 })), 'failed');
  assert.equal(checkState(checks({ passed: 3, total: 3 })), 'passed');
  assert.equal(checkState(null), null);
  assert.equal(isSlow(checks({ running: 1, total: 1, since: '2026-10-21T09:31:00Z' }), now), false);
  assert.equal(isSlow(checks({ running: 1, total: 1, since: '2026-10-21T09:30:00Z' }), now), true);
  assert.equal(isSlow(checks({ passed: 1, total: 1, since: '2026-10-21T08:00:00Z' }), now), false, 'only a running pipeline is slow');
  assert.equal(isSlow(checks({ running: 1, total: 1 }), now), false);
});

test('canAbandon takes List and Queued issues and drafts, never pull requests or other statuses', () => {
  const draft = { number: null, repo: null };
  for (const status of ['List', 'Queued'] as const) {
    assert.ok(canAbandon(item(status)), `${status} issue`);
    assert.ok(canAbandon(item(status, [], draft)), `${status} draft`);
    assert.ok(!canAbandon(item(status, [], { content: 'pr' })), `${status} pull request`);
  }
  for (const status of ['Shaping', 'In progress', 'Done'] as const) assert.ok(!canAbandon(item(status)), status);
});

test('a thread link is T3 Code\'s threads deep link, each id one path segment', () => {
  assert.equal(threadLink('5e-8c5a', 'thread-1'), 't3code://threads/5e-8c5a/thread-1');
  assert.equal(threadLink('env', 'a/b c'), 't3code://threads/env/a%2Fb%20c');
});

test('failedCheck gives a failed check, and nothing for one that passed or before the first check', () => {
  const ok = { result: 'ok' } as const;
  const tools = { gh: { result: 'logged-out', fix: 'gh auth login' }, t3: { result: 'ok', version: '0.1.3' }, git: ok, jq: { result: 'missing', fix: 'brew install jq' }, curl: ok } as const;
  assert.deepEqual(failedCheck(tools, 'gh'), { result: 'logged-out', fix: 'gh auth login' });
  assert.deepEqual(failedCheck(tools, 'jq'), { result: 'missing', fix: 'brew install jq' });
  assert.equal(failedCheck(tools, 't3'), undefined);
  assert.equal(failedCheck(undefined, 'gh'), undefined);
});

test('gh blocks every read while missing or logged out, and only Project reads without the project scope', () => {
  const fix = 'gh auth refresh -s project';
  for (const source of ['project', 'issues'] as const) {
    assert.equal(ghBlocksRead(undefined, source), true);
    assert.equal(ghBlocksRead({ result: 'missing', fix: 'brew install gh' }, source), true);
    assert.equal(ghBlocksRead({ result: 'logged-out', fix: 'gh auth login' }, source), true);
    assert.equal(ghBlocksRead({ result: 'ok', scopes: 'unread' }, source), false);
    assert.equal(ghBlocksRead({ result: 'outdated', version: '2.93.1', fix: 'brew upgrade gh' }, source), false);
  }
  assert.equal(ghBlocksRead({ result: 'no-project-scope', fix }, 'project'), true);
  assert.equal(ghBlocksRead({ result: 'no-project-scope', fix }, 'issues'), false);
  assert.equal(itemSource({ repo: 'maddec01/lar', platform: 'Apple', role: 'app' }), 'project');
});

test("a status's label is status- and its name in lowercase with hyphens for spaces", () => {
  assert.equal(statusLabel('Shaping'), 'status-shaping');
  assert.equal(statusLabel('Ready to merge'), 'status-ready-to-merge');
  assert.equal(statusLabel('Needs you'), 'status-needs-you');
});

test("an issue's labels hold the statuses whose labels it carries, in flow order, and never Done", () => {
  assert.deepEqual(labelStatuses(['bug', 'status-verify', 'status-shaping', 'status-done']), ['Shaping', 'Verify']);
  assert.deepEqual(labelStatuses(['bug']), []);
});

test('an item carrying more than one status moves only once one is kept, and says which it carries', () => {
  assert.equal(carriesTwoStatuses({ statuses: ['Ready', 'Verify'], state: 'open' }), true);
  assert.equal(carriesTwoStatuses({ statuses: ['Ready'], state: 'open' }), false);
  assert.equal(carriesTwoStatuses({ statuses: [], state: 'open' }), false);
  assert.equal(carriesTwoStatuses({ statuses: ['Ready', 'Verify'], state: 'closed' }), false, 'a closed item is Done, whatever labels it kept');
  assert.equal(keepOneText(['Ready', 'Verify']), 'This issue carries Ready and Verify. Keep one to move it again.');
  assert.equal(keepOneText(['Shaping', 'Ready', 'Review']), 'This issue carries Shaping, Ready and Review. Keep one to move it again.');
});
