// The Board view: its sections, cards and rows, read-only.
// Ported from the Board cases of test/render.test.ts.

import { beforeEach, expect, test } from 'vite-plus/test';
import { $, $$, NOW, mountPage, sample, settle, text, variantOf } from '../../test/support.ts';
import { normalizeItems } from '@mux-factory/shared';
import type { BoardData, Item, RawItem } from '@mux-factory/shared';
import { rawIssue, sliceRef } from '@mux-factory/shared/test/raw-items';

const card = (id: string) => $(`article[data-anchor="${id}"]`)!;
const listRow = (id: string) => $(`#list li[data-anchor="${id}"]`)!;
const ids = (selector: string, attr: string) => $$(selector).map((el) => el.getAttribute(attr)!).sort();
const statusIds = (status: string) => sample.items.filter((i) => i.status === status).map((i) => i.id);
const boardOf = (raws: RawItem[], builds = new Set<string>()): BoardData => ({ ...sample, error: null, items: normalizeItems(raws, { builds }) });
let mounted = false;
beforeEach(() => (mounted = false));

/** Mounts the page with `data` the first time in a test, then hands the page new data as the server would. */
async function show(data: BoardData): Promise<void> {
  if (!mounted) {
    mounted = true;
    return mountPage(data);
  }
  // The store instance the mounted page uses; modules reset between tests.
  const { useBoardStore } = await import('./board-store.ts');
  await settle(() => useBoardStore.getState().receive(data));
}
const openGroups = () => $$('.platform').filter((group) => group.hasAttribute('data-open')).map((group) => group.id);
const trigger = (id: string) => $(`#${id} > [data-slot="collapsible-trigger"]`)!;

test('the Board view shows a section per group of statuses, each with its count and note', async () => {
  await mountPage();
  expect($$('#panel-board > .section').map((s) => [s.id, text(s.querySelector('h2'))])).toEqual([
    ['needs-you', 'Needs you 4 Needs you, Verify and Ready to merge: only you can move these'],
    ['in-flight', 'In flight 8 Shaping, Ready, In progress, Review'],
    ['concepts', 'Concepts 1'],
    ['queued', 'Queued 3 Start opens a mux-work thread in T3 Code'],
    ['list', 'List 4'],
    ['done', 'Done 4 last 7 days'],
  ]);
  expect($('#needs-you')!.getAttribute('aria-labelledby')).toBe('needs-you-h');
  const cards = $$('#needs-you article');
  expect(cards.map((a) => a.getAttribute('data-slot'))).toEqual(['card', 'card', 'card', 'card']);
  expect(cards.map((a) => a.hasAttribute('data-accent')), 'amber while only you can move it').toEqual([true, true, true, false]);
});

test('a concept block shows its sub-issues done and its open sub-issues grouped by status', async () => {
  await mountPage();
  const concept = card('PVTI_sample09');
  expect(concept.closest('.cards.wide')).not.toBeNull();
  const bar = concept.querySelector('[role="progressbar"]')!;
  const fill = bar.querySelector<HTMLElement>('[data-slot="progress-indicator"]')!;
  expect([bar.getAttribute('data-slot'), bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax'), Math.round(parseFloat(fill.style.width))]).toEqual(['progress-bar', '2', '6', 33]);
  expect(text(concept.querySelector('[data-slot="progress-caption"]'))).toBe('2/6 sub-issues done');
  expect($$('#concepts .sub-group').map((g) => [text(g.querySelector('.sub-status')), [...g.querySelectorAll('li[data-anchor]')].map((li) => li.getAttribute('data-anchor'))]))
    .toEqual([['Shaping', ['PVTI_sample10']], ['Needs you', ['PVTI_sample12']], ['Ready', ['PVTI_sample13']]]);
  expect(concept.querySelector('.sub-group li .kind'), 'sub-issue rows keep the kind pill').not.toBeNull();
});

test('List groups open by default, Done stays closed, and a Hide closes one group', async () => {
  await mountPage();
  expect(openGroups()).toEqual(['list-server', 'list-apple', 'list-draft']);
  expect(text(trigger('list-draft'))).toBe('Draft 1 in List');
  expect(text(trigger('done-list'))).toBe('Show 4 items closed in the last 7 days');
  await settle(() => trigger('list-apple').click());
  expect(openGroups()).toEqual(['list-server', 'list-draft']);
  await settle(() => trigger('done-list').click());
  expect(openGroups()).toEqual(['list-server', 'list-draft', 'done-list']);
});

test('List and Done rows show one pill per label instead of the kind pill', async () => {
  await mountPage();
  const pills = (row: Element) => [...row.querySelectorAll('.labels > .label')].map(text);
  expect(pills(listRow('PVTI_sample03'))).toEqual(['feature', 'app: music', 'os: ios', 'os: macos']);
  expect(pills($('#done li[data-anchor="PVTI_sample19"]')!), 'Done rows too').toEqual(['bug', 'os: watchos']);
  expect(pills(listRow('PVTI_sample04')), 'a draft has no labels').toEqual([]);
  expect(listRow('PVTI_sample03').querySelector('.label.kind-feature')).not.toBeNull();
  expect(variantOf(listRow('PVTI_sample03').querySelector('.label'))).toBe('outline');
  for (const row of [listRow('PVTI_sample03'), $('#done li[data-anchor="PVTI_sample19"]')!]) expect(row.querySelector('.kind'), 'no separate kind pill').toBeNull();
});

test("a build's slices show no Status of their own", async () => {
  await mountPage();
  expect(card('PVTI_sample13').querySelector('.sub-status, [data-anchor^="PVTI_slice"]')).toBeNull();
});

const builtIssue = rawIssue('PVTI_build', 59, 'In progress', ['improvement', 'build'], {
  subIssuesSummary: { total: 3, completed: 1 },
  subIssues: { nodes: [sliceRef(65, 'CLOSED'), sliceRef(66, 'OPEN'), sliceRef(67, 'OPEN')] },
});

test('an open slice that the project auto-added is dropped from the board items, its cards and the header counts', async () => {
  const slice = rawIssue('PVTI_slice66', 66, 'In progress', ['improvement'], {
    parent: { number: 59, title: 'Issue 59', url: 'https://github.com/maddec01/mux-factory/issues/59', state: 'OPEN', repository: { nameWithOwner: 'maddec01/mux-factory' } },
  });
  const data = boardOf([slice, builtIssue, rawIssue('PVTI_other', 70, 'In progress', ['bug'])]);
  expect(data.items.map((i) => i.id), 'the slice is not a board item, wherever it sits in the project').toEqual(['PVTI_build', 'PVTI_other']);
  await mountPage(data);
  expect(text($('.totals'))).toBe('0 need you2 in flight0 queued0 in List2 items');
  expect($$('#panel-board [data-anchor]').map((el) => el.getAttribute('data-anchor'))).toEqual(['PVTI_build', 'PVTI_other']);
});

test('an improvement labelled build keeps its improvement pill and still carries its slices', async () => {
  expect(normalizeItems([builtIssue])[0]?.slices.map((s) => [s.number, s.state])).toEqual([[65, 'CLOSED'], [66, 'OPEN'], [67, 'OPEN']]);
  await mountPage(boardOf([builtIssue]));
  expect(text(card('PVTI_build').querySelector('.kind.kind-improvement'))).toBe('improvement');
  expect(['.plat', '.kind'].map((pill) => variantOf(card('PVTI_build').querySelector(pill))), 'pills are outline badges').toEqual(['outline', 'outline']);
});

/** A build card's slice bar segments, its caption, and its active line ('' when it's collapsed). */
function sliceBar(el: Element) {
  return {
    segments: [...el.querySelectorAll('.segbar.slice-bar > li')].map((li) => li.className),
    caption: text(el.querySelector('.slice-bar + .bar-label')),
    active: el.querySelector('.slices-now')?.innerHTML ?? '',
  };
}

async function buildCard(raws: RawItem[], active: number[] = [], blocked: number[] = []) {
  const keys = (numbers: number[]) => new Set(numbers.map((n) => `maddec01/mux-factory#${n}`));
  await show({ ...sample, error: null, items: normalizeItems(raws, { active: keys(active), blocked: keys(blocked) }) });
  return card('PVTI_build');
}

test('a build card shows its slices as a bar under the status bar, with captions and the active slices named', async () => {
  const build = await buildCard([builtIssue], [66]);
  expect(sliceBar(build)).toEqual({
    segments: ['done', 'active', 'waiting'],
    caption: '1/3 · Slices done',
    active: '<span class="slices-active">1 active</span> <span class="ref">#66</span> Issue 66',
  });
  const bars = build.querySelector('.bars')!;
  expect([...bars.children].map((c) => c.className), 'status bar and slice bar share one grid, captions in its right-hand column')
    .toEqual(['segbar steps', 'bar-label step-label now', 'segbar slice-bar', 'bar-label']);
  expect(text(bars.querySelector('.step-label'))).toBe('6/10 · In progress');
  expect(build.querySelector('.subs'), 'the caption replaces the meta row counter').toBeNull();
  expect(build.querySelector('.row-item'), 'no slice rows on the card: they are in the popover').toBeNull();
  expect(document.getElementById('slices-PVTI_build')!.querySelectorAll('.row-item').length).toBe(3);
});

test('a build card counts its blocked slices before its active ones, names either alone, and marks them in the bar', async () => {
  const raw = rawIssue('PVTI_build', 59, 'In progress', ['build'], {
    subIssuesSummary: { total: 4, completed: 1 },
    subIssues: { nodes: [sliceRef(65, 'CLOSED'), sliceRef(66, 'OPEN'), sliceRef(67, 'OPEN'), sliceRef(68, 'OPEN')] },
  });
  expect(sliceBar(await buildCard([raw], [66, 67], [67]))).toEqual({
    segments: ['done', 'active', 'blocked', 'waiting'],
    caption: '1/4 · Slices done',
    active: '<span class="slices-blocked">1 blocked</span><span class="sep"> · </span><span class="slices-active">1 active</span>',
  });
  expect(sliceBar(await buildCard([raw], [], [67])).active).toBe('<span class="slices-blocked">1 blocked</span> <span class="ref">#67</span> Issue 67');
});

test("a build card's popover lists every slice, blocked then active then waiting then done, behind a disclosure trigger", async () => {
  const raw = rawIssue('PVTI_build', 59, 'In progress', ['improvement', 'build'], {
    subIssuesSummary: { total: 4, completed: 1 },
    subIssues: { nodes: [sliceRef(65, 'OPEN'), sliceRef(66, 'CLOSED'), sliceRef(67, 'OPEN'), sliceRef(68, 'OPEN')] },
  });
  const build = await buildCard([raw], [67], [68]);
  const url = (n: number) => `https://github.com/maddec01/mux-factory/issues/${n}`;
  const pop = document.getElementById('slices-PVTI_build')!;
  expect([...pop.querySelectorAll('li.slice-row')].map((li) => [li.classList[2], text(li.querySelector('.ref')), li.querySelector('a')!.getAttribute('href')]))
    .toEqual([['blocked', '#68', url(68)], ['active', '#67', url(67)], ['waiting', '#65', url(65)], ['done', '#66', url(66)]]);
  expect(text(pop.querySelector('li.blocked .sr-only'))).toBe(' (blocked)');
  const trigger = build.querySelector('.slices-trigger')!;
  expect(['role', 'tabindex', 'aria-expanded', 'aria-controls'].map((a) => trigger.getAttribute(a))).toEqual(['button', '0', 'false', pop.id]);
  expect(build.querySelector('[role="tooltip"]'), 'a disclosure, not a tooltip').toBeNull();
});

test("a build's slice caption counts only visible slices, and the active line collapses when none is active", async () => {
  const raw = rawIssue('PVTI_build', 59, 'In progress', ['build'], {
    subIssuesSummary: { total: 4, completed: 2 },
    subIssues: { nodes: [sliceRef(65, 'CLOSED'), { ...sliceRef(66, 'CLOSED'), stateReason: 'NOT_PLANNED' }, sliceRef(67, 'OPEN'), sliceRef(68, 'OPEN')] },
  });
  expect(sliceBar(await buildCard([raw]))).toEqual({ segments: ['done', 'waiting', 'waiting'], caption: '1/3 · Slices done', active: '' });
});

test('a 3-slice and a 14-slice build render the same card structure', async () => {
  const build = (count: number) => rawIssue('PVTI_build', 59, 'In progress', ['build'], {
    subIssuesSummary: { total: count, completed: 1 },
    subIssues: { nodes: Array.from({ length: count }, (_, i) => sliceRef(100 + i, i ? 'OPEN' : 'CLOSED')) },
  });
  // Tags only, with the slice bar's segments and the popover's rows dropped: the popover floats.
  const shape = (el: Element) => {
    const copy = el.cloneNode(true) as Element;
    copy.querySelectorAll('.slice-bar > li, .slice-rows > li').forEach((li) => li.remove());
    return [...copy.querySelectorAll('*')].map((e) => `${e.tagName}.${e.className}`).join(' ');
  };
  const many = shape(await buildCard([build(14)], [101, 102]));
  expect(many).toBe(shape(await buildCard([build(3)], [101, 102])));
});

test('a blocked card says what blocks it in a red badge', async () => {
  await mountPage(boardOf([rawIssue('PVTI_blocked', 90, 'In progress', ['feature'], { issueDependenciesSummary: { blockedBy: 2 } })]));
  const tag = card('PVTI_blocked').querySelector('.blocked-by');
  expect([text(tag), tag?.getAttribute('title'), variantOf(tag)]).toEqual(['blocked by 2', 'Blocked by 2 issues', 'error']);
});

test('a card with sub-issues but no build or concept label shows only its counter', async () => {
  const plain = rawIssue('PVTI_plain', 80, 'In progress', ['feature'], {
    subIssuesSummary: { total: 2, completed: 0 }, subIssues: { nodes: [sliceRef(81, 'OPEN'), sliceRef(82, 'OPEN')] },
  });
  await mountPage(boardOf([plain]));
  expect(text(card('PVTI_plain').querySelector('.subs'))).toBe('0/2 sub-issues');
  expect(variantOf(card('PVTI_plain').querySelector('.subs'))).toBe('outline');
  expect(card('PVTI_plain').querySelector('[aria-label="Slices"]'), 'no fallback list').toBeNull();
});

test('a build shows its `build` sub-issues like any parent, with a counter', async () => {
  const parent = rawIssue('PVTI_parent', 100, 'In progress', ['build'], {
    subIssuesSummary: { total: 3, completed: 0 },
    subIssues: { nodes: [sliceRef(101, 'OPEN'), sliceRef(102, 'OPEN'), sliceRef(103, 'OPEN')] },
  });
  const child = rawIssue('PVTI_102', 102, 'In progress', ['build'], {
    parent: { number: 100, title: 'Issue 100', url: 'https://github.com/maddec01/mux-factory/issues/100', state: 'OPEN', repository: { nameWithOwner: 'maddec01/mux-factory' } },
  });
  await mountPage(boardOf([parent, child], new Set(['maddec01/mux-factory#102', 'maddec01/mux-factory#103'])));
  expect(text(card('PVTI_parent').querySelector('.subs')), 'the counter counts the build sub-issues, not the slice').toBe('0/2 sub-issues');
  expect(card('PVTI_parent').querySelector('.slice-bar'), 'its slice stays a slice').not.toBeNull();
  expect(text(card('PVTI_102').querySelector('.parent'))).toBe('Part of #100 Issue 100');
});

test('Queue and Abandon sit on List rows; Abandon also on Queued cards', async () => {
  await mountPage();
  expect(ids('[data-queue]', 'data-queue')).toEqual(statusIds('List').sort());
  expect(ids('[data-abandon]', 'data-abandon')).toEqual([...statusIds('List'), 'PVTI_sample05', 'PVTI_sample06', 'PVTI_sample21'].sort());
  const buttons = [...listRow('PVTI_sample01').querySelectorAll('button')];
  // T3's outline Button for Queue, its destructive-outline one for Abandon.
  expect(buttons.map((b) => [b.dataset.slot, b.classList.contains('text-destructive-foreground'), b.getAttribute('aria-label'), text(b)])).toEqual([
    ['button', false, 'Queue #61 Arr instances, catalog bindings and content requests', 'Queue'],
    ['button', true, 'Abandon #61 Arr instances, catalog bindings and content requests', 'Abandon'],
  ]);
});

test('Start appears only on Queued issues, alone in the top-right group; a queued draft asks for an issue first', async () => {
  await mountPage();
  expect(ids('[data-start]', 'data-start')).toEqual(sample.items.filter((i) => i.status === 'Queued' && i.number !== null).map((i) => i.id).sort());
  const start = card('PVTI_sample05').querySelector('.meta > .start-group > button[data-slot="menu-trigger"].bg-primary')!;
  expect(['aria-label', 'aria-haspopup', 'aria-expanded'].map((a) => start.getAttribute(a))).toEqual(['Start #129 Run more than one 4K HDR to 1080p stream at a time', 'menu', 'false']);
  expect(text(start)).toBe('Start ▾');
  expect(card('PVTI_sample05').querySelector('.cmd, [data-copy], svg'), 'no command box or copy icon').toBeNull();
  const draft = card('PVTI_sample21');
  expect(text(draft.querySelector('.foot .hint'))).toBe('This draft needs an issue before it can start. Convert it to an issue in a repo.');
  expect(draft.querySelector('[data-start], [data-copy], .start-group')).toBeNull();
});

const queuedPr: Item = { ...sample.items.find((i) => i.id === 'PVTI_sample05')!, id: 'PVTI_pr', type: 'PullRequest', number: 300, title: 'A queued pull request' };

test('Queued issues and drafts get a footer row with Back to List and Abandon; pull requests do not', async () => {
  await mountPage({ ...sample, items: [...sample.items, queuedPr] });
  expect(ids('[data-back-to-list]', 'data-back-to-list')).toEqual(['PVTI_sample05', 'PVTI_sample06', 'PVTI_sample21']);
  const footer = card('PVTI_sample05').lastElementChild!;
  expect(footer.className).toBe('card-actions');
  // T3's InlineButton, muted for Back to List and destructive for Abandon.
  expect([...footer.children].map((b) => [b.getAttribute('data-slot'), b.classList.contains('text-destructive/80'), b.getAttribute('aria-label'), text(b)])).toEqual([
    ['inline-button', false, 'Back to List #129 Run more than one 4K HDR to 1080p stream at a time', '← Back to List'],
    ['inline-button', true, 'Abandon #129 Run more than one 4K HDR to 1080p stream at a time', 'Abandon'],
  ]);
  expect(card('PVTI_sample21').querySelector('[data-back-to-list]')!.getAttribute('aria-label')).toBe('Back to List draft Offline downloads on watchOS');
  expect(card('PVTI_pr').querySelector('.card-actions, [data-abandon]')).toBeNull();
});

test('a thread another page started shows on every page, in place of Start and the footer', async () => {
  await mountPage({ ...sample, started: { PVTI_sample05: { threadId: 'thread-9', title: 'Shape the playback queue' } } });
  const tag = card('PVTI_sample05').querySelector('.start-group > .started-tag')!;
  expect([text(tag), tag.getAttribute('title'), tag.getAttribute('tabindex'), tag.getAttribute('data-start-result')]).toEqual(['Started', 'T3 thread thread-9', '-1', 'PVTI_sample05']);
  expect(card('PVTI_sample05').querySelector('[data-start], .card-actions')).toBeNull();
});

test('sample mode disables every write button; Start still opens its menu', async () => {
  await mountPage({ ...sample, capture: { session: 's', enabled: false } });
  const writes = $$<HTMLButtonElement>('[data-queue], [data-abandon], [data-back-to-list]');
  expect(writes.length, 'Queue on 4 List rows, Abandon on those and 3 Queued cards, Back to List on those').toBe(4 + 7 + 3);
  expect(writes.every((b) => b.disabled && b.title === 'Disabled in sample mode')).toBe(true);
  expect($$<HTMLButtonElement>('[data-start]').every((b) => !b.disabled && !b.hasAttribute('aria-disabled'))).toBe(true);
});

test('empty sections say what would go there, and how to queue', async () => {
  await mountPage({ ...sample, items: [] });
  expect($$('#panel-board .empty').map(text)).toEqual([
    'Nothing needs you right now.',
    'Nothing is being shaped, built or reviewed.',
    'No open concepts.',
    'Nothing queued. Press Queue on a List item to queue it.',
    'Nothing in List.', 'Nothing in List.',
    'Nothing closed this week.',
  ]);
  expect(text($('#panel-board'))).not.toMatch(/drag|in a new T3 thread/i);
});

test('a card shows its hint and its linked PRs on the foot line', async () => {
  await mountPage();
  expect(text(card('PVTI_sample16').querySelector('.foot'))).toMatch(/^Test it with the steps in the PR, then mergePR #\d+/);
  expect(card('PVTI_sample11').querySelector('.foot .hint')!.textContent).toBe('Answer in its T3 thread');
});

test('a linked PR shows its checks: running with counts and age, amber when slow, passed, failed, or nothing', async () => {
  const pr = { number: 9, url: 'https://github.com/maddec01/mux-server/pull/9', state: 'OPEN', isDraft: false };
  const item = { ...sample.items[0]!, status: 'Review' as const, linkedPrs: [
    { ...pr, checks: { passed: 3, failed: 0, running: 2, total: 5, since: '2026-10-21T09:48:00Z' } },
    { ...pr, number: 10, checks: { passed: 1, failed: 0, running: 1, total: 2, since: '2026-10-21T09:00:00Z' } },
    { ...pr, number: 11, checks: { passed: 5, failed: 0, running: 0, total: 5, since: '2026-10-21T09:00:00Z' } },
    { ...pr, number: 12, checks: { passed: 4, failed: 1, running: 0, total: 5, since: '2026-10-21T09:00:00Z' } },
    { ...pr, number: 13, checks: null },
    { ...pr, number: 14, state: 'CLOSED', checks: { passed: 0, failed: 1, running: 0, total: 1, since: null } },
    { ...pr, number: 15, isDraft: true, checks: null },
  ] };
  await mountPage({ ...sample, items: [item] });
  expect($$('.linked-pr').map((l) => [text(l.querySelector('a.pr')), variantOf(l.querySelector('.checks')), l.querySelector('.checks')?.getAttribute('title'), text(l.querySelector('.checks'))])).toEqual([
    ['PR #9', 'outline', 'Checks running: 3 of 5 passed, 2 running', 'checks 3/5 · 12m'],
    ['PR #10', 'warning', 'Checks running for over 30 minutes: 1 of 2 passed, 1 running', 'checks 1/2 · 1h 0m (running over 30 minutes)'],
    ['PR #11', 'outline', 'All 5 checks passed', 'checks passed'],
    ['PR #12', 'error', '1 of 5 checks failed', 'checks failed'],
    ['PR #13', undefined, undefined, ''],
    ['PR #14 (closed)', undefined, undefined, ''],
    ['PR #15 (draft)', undefined, undefined, ''],
  ]);
  expect($('.checks.slow .sr-only')).not.toBeNull();
});

const sigma = "Σ is agent time: all agents' work, parallel work added up, less waits on you.";
const wall = ' Wall is the time any agent was working, less waits on you.';
const tokens = " Tokens are counted as T3 Code's usage page counts them.";
const priced = ' The cost is an API estimate at list prices, not the subscription bill.';
const badges = (selector: string) => $$(selector).map((s) => [s.getAttribute('title'), text(s)]);

test('cards and Done rows show item stats, agent time, wall time, total tokens and API cost, or that they are unavailable', async () => {
  const stats = { agentMs: (3 * 60 + 20) * 60_000 + 59_000, wallMs: 70 * 60_000, tokens: 12_436_000, costUsd: 41.197 };
  const statsOf = async (item: Partial<Item>) => {
    await show({ ...sample, items: [{ ...sample.items[0]!, ...item }] });
    return badges('.stats');
  };
  // Σ shows; screen readers hear "agent time" instead.
  expect(await statsOf({ status: 'Review', stats })).toEqual([[`${sigma}${wall}${tokens}${priced}`, 'Σagent time 3h 20m · wall 1h 10m · 12.4M · $41.20']]);
  expect($('.stats > [aria-hidden="true"]')!.textContent).toBe('Σ');
  expect($('.stats > .sr-only')!.textContent).toBe('agent time');
  expect(await statsOf({ status: 'In progress', stats: { agentMs: 45 * 60_000, wallMs: 30 * 60_000, tokens: 980 } }), 'nothing priced, no cost and no cost sentence')
    .toEqual([[`${sigma}${wall}${tokens}`, 'Σagent time 45m · wall 30m · 980']]);
  expect(await statsOf({ status: 'Shaping', stats: 'unavailable' })).toEqual([['The T3 Code database could not be read', 'stats unavailable']]);
  expect(await statsOf({ status: 'Done', closedAt: '2026-10-20T10:00:00Z', stats }), 'Done rows keep their stats')
    .toEqual([[`${sigma}${wall}${tokens}${priced}`, 'Σagent time 3h 20m · wall 1h 10m · 12.4M · $41.20']]);
  expect(await statsOf({ status: 'Ready' }), 'no stats without matched threads').toEqual([]);
  const done = { status: 'Done', closedAt: '2026-10-20T10:00:00Z' } as const;
  const frozen = ' Frozen when the PR merged, times rounded, cost to the nearest dollar.';
  expect(await statsOf({ ...done, stats: { agentMs: 200 * 60_000, wallMs: 75 * 60_000, tokens: 12_400_000, costUsd: 41, frozen: true } }), 'frozen figures show the whole-dollar cost the PR holds')
    .toEqual([[`${sigma}${wall}${tokens}${priced}${frozen}`, 'Σagent time 3h 20m · wall 1h 15m · 12.4M · $41']]);
  expect(await statsOf({ ...done, stats: { agentMs: 200 * 60_000, tokens: 12_400_000, costUsd: 41, frozen: true } }), 'figures frozen before wall time leave it out')
    .toEqual([[`${sigma}${tokens}${priced}${frozen}`, 'Σagent time 3h 20m · 12.4M · $41']]);
  expect(await statsOf({ ...done, stats: { agentMs: 0, tokens: 980, costUsd: 0, frozen: true } }))
    .toEqual([[`${sigma}${tokens}${priced}${frozen}`, 'Σagent time 0m · 980 · <$1']]);
  expect(await statsOf({ ...done, stats: { agentMs: 0, tokens: 980, frozen: true } }), 'frozen without a cost')
    .toEqual([[`${sigma}${tokens} Frozen when the PR merged, times rounded.`, 'Σagent time 0m · 980']]);
});

test('item stats sit in their own last row on a card; on a Queued card the actions row comes after it', async () => {
  const stats = { agentMs: 20 * 60_000, wallMs: 30 * 60_000, tokens: 1_200 };
  await mountPage({ ...sample, items: sample.items.map((i) => (i.id === 'PVTI_sample05' || i.status === 'In progress' ? { ...i, stats } : i)) });
  const queued = card('PVTI_sample05');
  expect([...queued.children].slice(-2).map((c) => c.className), 'stats row first, actions row last').toEqual(['card-stats', 'card-actions']);
  const withStats = $$('article[data-slot="card"]').filter((c) => c.querySelector('.stats') && !c.querySelector('.card-actions'));
  expect(withStats.length).toBeGreaterThan(0);
  for (const c of withStats) expect(c.lastElementChild!.className, "the stats row is the card's last element").toBe('card-stats');
  expect($('.foot .stats'), 'the foot line holds no stats').toBeNull();
});

test('cards and Done rows show a "total" badge beside the item stats when sub-issues add figures', async () => {
  const [first] = sample.items;
  const parentRef = { number: 70, title: 'Parent', url: 'https://github.com/maddec01/mux-server/issues/70', repo: 'maddec01/mux-server', state: 'OPEN' as const };
  const parent: Item = { ...first!, id: 'p', number: 70, repo: 'maddec01/mux-server', labels: [], status: 'In progress', parent: null,
    stats: { agentMs: 30 * 60_000, wallMs: 20 * 60_000, tokens: 1_000, costUsd: 2 } };
  const build = (id: string, number: number, closedAt: string): Item => ({ ...first!, id, number, repo: 'maddec01/mux-server', labels: ['build'],
    status: 'Done', closedAt, parent: parentRef, stats: { agentMs: 60 * 60_000, wallMs: 40 * 60_000, tokens: 2_000_000, costUsd: 10, frozen: true } });
  const added = 'The total adds the item stats of this item and of its sub-issues on the board, each once: agent time first, then wall time, '
    + 'tokens and API cost, as in the item stats. Times are added up across sub-issues, wall time too, so builds that ran side by side count in full.';
  await show({ ...sample, items: [parent, build('b1', 71, '2026-10-19T10:00:00Z'), build('b2', 72, '2026-10-20T10:00:00Z')] });
  expect(badges('.stats.total'), 'the parent shows its total; each build is a Done row with its own frozen figures and no total')
    .toEqual([[added, 'total 2h 30m · wall 1h 40m · 4M · $22.00']]);
  expect(card('p').querySelector('.card-stats .stats:not(.total) + .stats.total')).not.toBeNull();
  expect($$('.stats:not(.total)').length, 'item stats on the parent card and on each Done row').toBe(3);

  await show({ ...sample, items: [{ ...parent, status: 'Done', closedAt: '2026-10-20T11:00:00Z' }, build('b1', 71, '2026-10-19T10:00:00Z')] });
  expect(text($('#done li[data-anchor="p"] .stats.total')), 'a Done row shows its total too').toBe('total 1h 30m · wall 1h 0m · 2M · $12.00');

  await show({ ...sample, items: [{ ...parent, stats: undefined }, build('b1', 71, '2026-10-19T10:00:00Z'), build('b2', 72, '2026-10-20T10:00:00Z')] });
  expect(badges('.stats.total'), 'a total of frozen figures only says so, like the item stats')
    .toEqual([[`${added} Frozen when the PR merged, times rounded, cost to the nearest dollar.`, 'total 2h 0m · wall 1h 20m · 4M · $20']]);
  await show({ ...sample, items: [parent, { ...build('b1', 71, '2026-10-19T10:00:00Z'), stats: 'unavailable' }] });
  expect(badges('.stats.total')).toEqual([['The T3 Code database could not be read', 'total unavailable']]);
  await show({ ...sample, items: [{ ...parent, stats: 'unavailable' }, build('b1', 71, '2026-10-19T10:00:00Z')] });
  expect(badges('.stats.total'), 'an item whose own stats are unavailable says so once, in its stats badge').toEqual([]);
});

test('Done rows show when each item closed, most recent first', async () => {
  await mountPage();
  const rows = $$('#done li[data-anchor]');
  expect(rows.map((r) => r.getAttribute('data-anchor'))).toEqual(
    sample.items.filter((i) => i.status === 'Done' && NOW - Date.parse(i.closedAt ?? i.updatedAt) <= 7 * 24 * 3600_000)
      .sort((a, b) => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt)).map((i) => i.id),
  );
  expect(rows.every((r) => r.lastElementChild!.className === 'when' && text(r.lastElementChild) !== '')).toBe(true);
});

test('the page has the polite live region Copy announces through', async () => {
  await mountPage();
  expect($('#copy-status[role="status"][aria-live="polite"].sr-only')).not.toBeNull();
});
