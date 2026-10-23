// The board's fixed template. Pure functions from data to HTML strings, shared
// by the server (initial page, tests) and the browser (re-render every 15 s).

import {
  AMBER_STATUSES,
  STATUSES,
  canAbandon,
  checkState,
  countsOf,
  isBuild,
  isOnBoard,
  isRecentlyDone,
  isSlow,
  isStale,
  itemTotal,
  kindLabel,
  kindOf,
  platformOf,
  ref,
  workMessage,
  workTitle,
} from './model.ts';
import type { BoardData, ToolMissing, ToolProblem, IssueLinks, IssueRef, Item, ItemStats, LinkedPr, ModelChoice, SliceProgress, StartedThread, Status, UpdateStep } from './model.ts';
import { highlightedChoice } from './start-menu.ts';
import { applicability, ITEM_KINDS } from './add-item.ts';
import { ago, clock, day, duration, elapsed, esc, formatTokens, formatUsd, plural, slug, wholeUsd } from './format.ts';
import type { UiState, View } from './ui-state.ts';
import { BRAND_MARK } from './brand-mark.ts';

export interface RenderOptions {
  now: number;
  /** IANA time zone for clock times; undefined means the runtime's own. */
  timeZone?: string;
  ui: UiState;
  /** Set by the browser when it can't reach the board server. */
  clientError?: string | null;
  /** What this page just did, announced in a toast. `key` is new for every notice. */
  notice?: Notice | null;
  /** Per item id: what this page is doing for the item. */
  actions?: Record<string, ItemAction>;
  /** What this page knows about an update that the server can't report: its own request, or a board that didn't come back. */
  updateView?: UpdateView | null;
  /** Keys of the notices closed on this page. */
  dismissed?: ReadonlySet<string>;
  /** Set while this page's Recheck runs. */
  rechecking?: boolean;
  /** Set once this page's Recheck answered, while the tool problems are the ones it answered. */
  rechecked?: RecheckAnswer;
}

export type Notice = { key: string } & (
  | { verb: 'Added' | 'Moved'; item: Item; to: Status }
  | { verb: 'Abandoned'; item: Item }
  /** A Queued card's Back to List (`to`) or Abandon (no `to`) failed. */
  | { verb: 'Failed'; item: Item; to?: Status; message: string }
  | { verb: 'Started'; item: Item; thread: StartedThread }
);

export type UpdateView = { phase: 'starting' } | { phase: 'refused'; message: string } | { phase: 'lost' };

/** How long after it finished a successful update still shows its toast on a new page. */
export const UPDATE_RESULT_MS = 15 * 60 * 1000;

const UPDATE_HINTS: Record<UpdateStep, string> = {
  check: 'Put the checkout back on a clean main, then press Update.',
  fetch: 'Check GitHub access and reconcile local main with origin/main, then press Update.',
  install: 'pnpm install failed; fix what the message or log shows, then press Update.',
  restart: 'The launch agent could not be reinstalled; fix what the log shows, then press Update.',
  health: 'The new board did not answer in time; check the board log, then press Update.',
  skills: 'The skills install failed; check the gh login and the log, then press Update.',
  profiles: 'Resolve the conflicting skill links in the log, then press Update.',
  done: 'Press Update to retry.',
};

/** An action this page started for an item: in flight, failed, or (for Start) done. */
export interface ItemAction {
  phase: 'pending' | 'error' | 'uncertain' | 'started';
  /** Set for Abandon and Back to List; Queue and Start leave it unset. */
  kind?: 'abandon' | 'back-to-list';
  message?: string;
  thread?: StartedThread;
}

// ---------- small helpers ----------

function byFlowOrder(a: Item, b: Item): number {
  return (
    STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    (a.repo ?? '').localeCompare(b.repo ?? '') ||
    (a.number ?? 0) - (b.number ?? 0)
  );
}

export function listGroupId(platform: string): string {
  return `list-${slug(platform)}`;
}

function isOpen(ui: UiState, id: string, byDefault: boolean): string {
  return ui.toggled[id] ?? byDefault ? ' open' : '';
}

// ---------- shared bits ----------

function platformBadge(item: Item, data: BoardData): string {
  const platform = platformOf(item, data.repos);
  return `<span class="plat plat-${esc(slug(platform))}">${esc(platform)}</span>`;
}

function kindPill(item: Item): string {
  return `<span class="kind kind-${kindOf(item)}">${esc(kindLabel(item))}</span>`;
}

/** One pill per GitHub label, kind included; a kind label keeps its colour. Always rendered, so it pushes a row's buttons to the end. */
function labelPills(item: Item): string {
  return `<span class="labels">${item.labels.map((l) => `<span class="label kind-${esc(slug(l))}">${esc(l)}</span>`).join('')}</span>`;
}

function titleLink(item: Item, cls = 'title'): string {
  const text = `<span class="ref">${esc(ref(item))}</span> ${esc(item.title)}`;
  return item.url
    ? `<a class="${cls}" href="${esc(item.url)}" target="_blank" rel="noopener">${text}</a>`
    : `<span class="${cls}">${text}</span>`;
}

/** Ten segments, one per status, with the item's current status coloured, then its caption: two cells of a `.bars` grid. */
function stepCells(status: Status): string {
  const at = STATUSES.indexOf(status);
  const tone = AMBER_STATUSES.includes(status) ? 'amber' : status === 'Done' ? 'done' : 'now';
  const segments = STATUSES.map((s, i) => {
    const state = i < at ? 'past' : i === at ? `cur ${tone}` : 'next';
    return `<li class="${state}" title="${esc(s)}"></li>`;
  }).join('');
  return `<ol class="segbar steps" aria-hidden="true">${segments}</ol><span class="bar-label step-label ${tone}">${at + 1}/${STATUSES.length} · ${esc(status)}</span>`;
}

/** The popover lists blocked slices first, then active, waiting and done. */
const SLICE_GROUPS: SliceProgress[] = ['blocked', 'active', 'waiting', 'done'];

/** The slice states the line under a build's bars names, in order. */
const NAMED_SLICES = ['blocked', 'active'] as const;

/**
 * The status bar, and on a build with slices its slice bar under it: one segment per
 * slice, the captions sharing a column, and one line naming the blocked or the active slices (counting them when both are present). Its
 * height doesn't grow with the number of slices: they're listed in a popover that
 * floats over the board. The block is the popover's disclosure trigger; `open` is
 * kept in `UiState.slicesOpen` so a re-render keeps it open.
 */
function bars(item: Item, open: boolean): string {
  const slices = item.slices;
  if (!slices.length) return `<div class="bars">${stepCells(item.status)}</div>`;
  const done = slices.filter((s) => s.progress === 'done').length;
  const segments = slices.map((s) => `<li class="${s.progress}"></li>`).join('');
  const sep = '<span class="sep"> · </span>';
  const groups = NAMED_SLICES.map((g) => ({ g, group: slices.filter((s) => s.progress === g) })).filter(({ group }) => group.length);
  // Both groups together show counts only, so the active ones never truncate away.
  const named = groups.map(({ g, group }) => {
    const count = `<span class="slices-${g}">${group.length} ${g}</span>`;
    return groups.length > 1 ? count : `${count} ${group.map((s) => `<span class="ref">#${s.number}</span> ${esc(s.title)}`).join(sep)}`;
  });
  const now = named.length ? `<p class="slices-now">${named.join(sep)}</p>` : '';
  // Within each group, slices keep GitHub's sub-issue order.
  const rows = SLICE_GROUPS.flatMap((g) => slices.filter((s) => s.progress === g)).map(
    (s) => `<li class="row-item slice-row ${s.progress}"><span class="slice-mark" aria-hidden="true"></span><a class="row-title" href="${esc(s.url)}" title="${esc(s.title)}" target="_blank" rel="noopener"><span class="ref">#${s.number}</span> ${esc(s.title)}<span class="sr-only"> (${s.progress})</span></a></li>`,
  ).join('');
  const popId = `slices-${esc(item.id)}`;
  return `<div class="slices${open ? ' open' : ''}" data-slices="${esc(item.id)}"><div class="slices-trigger" role="button" tabindex="0" aria-expanded="${open}" aria-controls="${popId}"><div class="bars">${stepCells(item.status)}<ol class="segbar slice-bar" aria-hidden="true">${segments}</ol><span class="bar-label">${done}/${slices.length} · Slices done</span></div>${now}</div>
<div class="slices-pop" id="${popId}"><ul class="slice-rows" aria-label="Slices">${rows}</ul></div></div>`;
}

/** The badge after an open PR's link: running with counts and age, passed, failed, or nothing. */
function checksBadge(pr: LinkedPr, now: number): string {
  const checks = pr.checks;
  const state = checkState(checks);
  if (!checks || !state || pr.state !== 'OPEN') return '';
  if (state === 'passed') return `<span class="checks passed" title="All ${plural(checks.total, 'check')} passed">checks passed</span>`;
  if (state === 'failed') return `<span class="checks failed" title="${checks.failed} of ${plural(checks.total, 'check')} failed">checks failed</span>`;
  const slow = isSlow(checks, now);
  const title = `Checks running${slow ? ' for over 30 minutes' : ''}: ${checks.passed} of ${checks.total} passed, ${checks.running} running${checks.failed ? `, ${checks.failed} failed` : ''}`;
  const age = checks.since ? ` · ${elapsed(checks.since, now)}` : '';
  return `<span class="checks running${slow ? ' slow' : ''}" title="${esc(title)}">checks ${checks.passed}/${checks.total}${age}${slow ? '<span class="sr-only"> (running over 30 minutes)</span>' : ''}</span>`;
}

const HINTS: Partial<Record<Status, string>> = {
  'Needs you': 'Answer in its T3 thread',
  Verify: 'Test it with the steps in the PR, then merge',
  'Ready to merge': 'Merge the PR',
};

/**
 * Agent time, wall time, total tokens and API cost, `Σ 3h 20m · wall 1h 10m · 12.4M · $41.20`,
 * for a card's footer or a Done row; nothing when no thread worked on the item, no
 * wall time in figures frozen before it existed, and no cost when none of its
 * tokens could be priced. Screen readers hear "agent time" for Σ.
 */
function statsBadge(item: Item): string {
  const stats = item.stats;
  if (!stats) return '';
  if (stats === 'unavailable') return `<span class="stats" title="${UNREADABLE}">stats unavailable</span>`;
  const title = "Σ is agent time: all agents' work, parallel work added up, less waits on you." +
    (stats.wallMs === undefined ? '' : ' Wall is the time any agent was working, less waits on you.') +
    " Tokens are counted as T3 Code's usage page counts them." +
    (stats.costUsd !== undefined ? ' The cost is an API estimate at list prices, not the subscription bill.' : '') + frozenNote(stats);
  return `<span class="stats" title="${title}"><span aria-hidden="true">Σ</span><span class="sr-only">agent time</span> ${figures(stats)}</span>`;
}

/**
 * The item total, `total 4h 10m · wall 2h 0m · 14.4M · $63.20`, beside the item stats
 * when sub-issues on the board add figures to them; never Σ, which means agent time.
 */
function totalBadge(item: Item, data: BoardData): string {
  // The stats badge already says the item's own stats are unavailable.
  if (item.stats === 'unavailable') return '';
  const total = itemTotal(item, data.items);
  if (!total) return '';
  if (total === 'unavailable') return `<span class="stats total" title="${UNREADABLE}">total unavailable</span>`;
  const title = 'The total adds the item stats of this item and of its sub-issues on the board, each once: ' +
    'agent time first, then wall time, tokens and API cost, as in the item stats. ' +
    'Times are added up across sub-issues, wall time too, so builds that ran side by side count in full.' + frozenNote(total);
  return `<span class="stats total" title="${title}">total ${figures(total)}</span>`;
}

const UNREADABLE = 'The T3 Code database could not be read';

/** The tooltip sentence for figures read back from merged PRs; '' for live ones. */
function frozenNote(stats: ItemStats): string {
  return stats.frozen ? ` Frozen when the PR merged, times rounded${stats.costUsd !== undefined ? ', cost to the nearest dollar' : ''}.` : '';
}

/** Agent time, wall time when known, tokens and cost when priced; a frozen cost in whole dollars. */
function figures(stats: ItemStats): string {
  const wall = stats.wallMs === undefined ? '' : ` · wall ${duration(stats.wallMs)}`;
  const cost = stats.costUsd === undefined ? '' : ` · ${esc(stats.frozen ? wholeUsd(stats.costUsd) : formatUsd(stats.costUsd))}`;
  return `${duration(stats.agentMs)}${wall} · ${formatTokens(stats.tokens)}${cost}`;
}

/** `action` is a button for the card's top row, so it adds no height. `after` is a row below the item stats, as the Queued card's actions. */
function card(item: Item, data: BoardData, opts: RenderOptions, extra = '', action = '', after = ''): string {
  const parent = item.parent
    ? `<p class="parent">Part of <a href="${esc(item.parent.url)}" target="_blank" rel="noopener">#${item.parent.number} ${esc(item.parent.title)}</a></p>`
    : '';
  const blocked = item.blockedBy
    ? `<span class="blocked-by" title="Blocked by ${plural(item.blockedBy, 'issue')}">blocked by ${item.blockedBy}</span>`
    : '';
  // A build's slices aren't counted here: its slice bar shows them.
  const subs = item.subIssues.total
    ? `<span class="subs">${item.subIssues.completed}/${item.subIssues.total} sub-issues</span>`
    : '';
  const hint = HINTS[item.status];
  const prs = item.linkedPrs
    .map(
      (pr) =>
        `<span class="linked-pr"><a class="pr" href="${esc(pr.url)}" target="_blank" rel="noopener">PR #${pr.number}${pr.isDraft ? ' (draft)' : pr.state === 'OPEN' ? '' : ` (${esc(pr.state.toLowerCase())})`}</a>${checksBadge(pr, opts.now)}</span>`,
    )
    .join('');
  const stats = statsBadge(item) + totalBadge(item, data);
  const foot = hint || prs ? `<p class="foot">${hint ? `<span class="hint">${esc(hint)}</span>` : ''}${prs}</p>` : '';
  const statsRow = stats ? `<p class="card-stats">${stats}</p>` : '';
  return `<article class="card${AMBER_STATUSES.includes(item.status) ? ' amber' : ''}" data-anchor="${esc(item.id)}">
<div class="meta"><span class="badges">${platformBadge(item, data)}${kindPill(item)}${blocked}${subs}</span>${action}</div>
${titleLink(item)}
${parent}${bars(item, opts.ui.slicesOpen === item.id)}${foot}${extra}${statsRow}${after}
</article>`;
}

/**
 * "done/total noun done" for Flow, or '' with nothing to count. A build counts its
 * visible slices, which leave out those closed as not planned.
 */
function subsDone(item: Item): string {
  const [done, total, noun] = isBuild(item)
    ? [item.slices.filter((s) => s.progress === 'done').length, item.slices.length, 'slices']
    : [item.subIssues.completed, item.subIssues.total, 'sub-issues'];
  return total ? `${done}/${total} ${noun} done` : '';
}

function section(id: string, title: string, count: number, body: string, note = ''): string {
  return `<section class="section" id="${id}" aria-labelledby="${id}-h">
<h2 id="${id}-h" tabindex="-1">${esc(title)} <span class="count">${count}</span>${note ? ` <span class="note">${esc(note)}</span>` : ''}</h2>
${body}
</section>`;
}

function cards(items: Item[], data: BoardData, opts: RenderOptions, empty: string, extra?: (i: Item) => string, action?: (i: Item) => string, after?: (i: Item) => string): string {
  if (!items.length) return `<p class="empty">${esc(empty)}</p>`;
  return `<div class="cards">${items.map((i) => card(i, data, opts, extra?.(i), action?.(i), after?.(i))).join('\n')}</div>`;
}

/** List and Done rows show every label; sub-issue rows keep the card's kind pill. */
function row(item: Item, data: BoardData, trailing = '', withPlatform = true, pills: 'labels' | 'kind' = 'labels'): string {
  return `<li class="row-item" data-anchor="${esc(item.id)}">${withPlatform ? platformBadge(item, data) : ''}${titleLink(item, 'row-title')}${pills === 'labels' ? labelPills(item) : kindPill(item)}${trailing}</li>`;
}

/** A close button. The key names what it closes: a notice, or `action:<item id>` for a card's error; `what` names it for screen readers. */
function dismissButton(key: string, what: string): string {
  return `<button type="button" class="dismiss" data-dismiss="${esc(key)}" aria-label="Dismiss${esc(what)}">&#215;</button>`;
}

/** A closed error keeps its phase without its message, so a Start that may have run stays hidden. */
function actionError(item: Item, action: ItemAction | undefined): string {
  return (action?.phase === 'error' || action?.phase === 'uncertain') && action.message
    ? `<span class="action-error"><span role="alert">${esc(action.message)}</span> ${dismissButton(`action:${item.id}`, ` error for ${ref(item)}`)}</span>`
    : '';
}

/** Board writes are off in sample mode, so its buttons are too. */
function writeState(data: BoardData, action: ItemAction | undefined): string {
  if (data.capture?.enabled === false) return ' disabled title="Disabled in sample mode"';
  return action?.phase === 'pending' || data.update?.state === 'running' ? ' aria-disabled="true"' : '';
}

function queueButton(item: Item, data: BoardData, action: ItemAction | undefined): string {
  const verb = action?.phase === 'pending' && !action.kind ? 'Queuing…' : 'Queue';
  return `<button type="button" class="copy row-action" data-queue="${esc(item.id)}" aria-label="${verb} ${esc(ref(item))} ${esc(item.title)}"${writeState(data, action)}>${verb}</button>`;
}

/** Abandon styled as a List row's button, or as a Queued card footer's link. */
function abandonButton(item: Item, data: BoardData, action: ItemAction | undefined, cls = 'copy row-action abandon'): string {
  if (!canAbandon(item)) return '';
  const verb = action?.phase === 'pending' && action.kind === 'abandon' ? 'Abandoning…' : 'Abandon';
  return `<button type="button" class="${cls}" data-abandon="${esc(item.id)}" aria-label="${verb} ${esc(ref(item))} ${esc(item.title)}"${writeState(data, action)}>${verb}</button>`;
}

/** The muted link-style button in a Queued card's footer row that moves it back to List. */
function backToListButton(item: Item, data: BoardData, action: ItemAction | undefined): string {
  const moving = action?.phase === 'pending' && action.kind === 'back-to-list';
  return `<button type="button" class="link-action" data-back-to-list="${esc(item.id)}" aria-label="${moving ? 'Moving' : 'Back to List'} ${esc(ref(item))} ${esc(item.title)}"${writeState(data, action)}>\u2190 ${moving ? 'Moving to List…' : 'Back to List'}</button>`;
}

/** The T3 thread Start opened for the item, from this page or another. */
function startedThread(item: Item, data: BoardData, action: ItemAction | undefined) {
  return data.started?.[item.id] ?? (action?.phase === 'started' ? action.thread : undefined);
}

/** Whether Start is in flight, uncertain or done, which takes Back to List and Abandon away. */
function startHolds(item: Item, data: BoardData, action: ItemAction | undefined): boolean {
  return !!startedThread(item, data, action) || action?.phase === 'uncertain' || (action?.phase === 'pending' && !action.kind);
}

/** Start's menu: "T3 default", then each provider instance's models, with the last choice highlighted. Sample mode shows it but starts nothing. */
function startMenu(item: Item, data: BoardData, lastChoice: ModelChoice | undefined): string {
  const highlight = highlightedChoice(data.modelChoices, lastChoice);
  const off = data.capture?.enabled === false ? ' aria-disabled="true" title="Disabled in sample mode"' : '';
  const entry = (label: string, checked: boolean, choice = '') =>
    `<li role="none"><button type="button" role="menuitemradio" aria-checked="${checked}" class="start-pick"${off} data-start-pick="${esc(item.id)}"${choice}>${esc(label)}</button></li>`;
  const groups = data.modelChoices.map((g) =>
    `<p class="start-menu-group" aria-hidden="true">${esc(g.name)}</p><ul role="group" aria-label="${esc(g.name)}">${g.models
      .map((m) => entry(m.label, highlight?.instanceId === g.instanceId && highlight.model === m.slug, ` data-instance-id="${esc(g.instanceId)}" data-model="${esc(m.slug)}"`)).join('')}</ul>`).join('');
  return `<div class="start-menu" role="menu" aria-label="Start ${esc(ref(item))} with">
<p class="start-menu-head" aria-hidden="true">Start with</p><ul role="none">${entry('T3 default', !highlight)}</ul>${groups}
</div>`;
}

/** Start's button for the card's top row, with its menu when open, and the message under the card when there is one. */
function startControl(item: Item, data: BoardData, action: ItemAction | undefined, ui: UiState): { button: string; message: string } {
  const thread = startedThread(item, data, action);
  // The toast announces a start; the card only keeps Start from running twice.
  if (thread) return { button: `<span class="started-tag" tabindex="-1" data-start-result="${esc(item.id)}" title="T3 thread ${esc(thread.threadId)}">Started</span>`, message: '' };
  if (action?.phase === 'uncertain') {
    // Once its message is closed, a tag still says why Start is gone.
    if (!action.message) return { button: `<span class="started-tag unsure" tabindex="-1" data-start-result="${esc(item.id)}" title="Check T3 before starting it again">May have started</span>`, message: '' };
    return { button: '', message: `<p class="start" tabindex="-1" data-start-result="${esc(item.id)}">${actionError(item, action)}</p>` };
  }
  // Back to List and Abandon carry a kind; only Start's own action relabels it.
  const own = action?.kind ? undefined : action;
  const verb = own?.phase === 'pending' ? 'Starting…' : own?.phase === 'error' ? 'Retry start' : 'Start';
  // Sample mode keeps Start's menu open-able, so the model choices can be seen; its entries start nothing.
  const state = data.capture?.enabled === false ? '' : writeState(data, action);
  const open = ui.startMenuOpen === item.id && !state;
  return {
    button: `<button type="button" class="copy start-item" data-start="${esc(item.id)}" aria-label="${verb} ${esc(ref(item))} ${esc(item.title)}" aria-haspopup="menu" aria-expanded="${open}"${state}>${verb}${own?.phase === 'pending' ? '' : ' \u25be'}</button>${open ? startMenu(item, data, ui.lastChoice) : ''}`,
    message: own?.phase === 'error' ? `<p class="start">${actionError(item, own)}</p>` : '',
  };
}

// ---------- header ----------

function updateButton(data: BoardData, opts: RenderOptions): string {
  const busy = opts.updateView?.phase === 'starting' || (data.update?.state === 'running' && opts.updateView?.phase !== 'lost');
  return `<button type="button" class="copy" data-update aria-label="${busy ? 'Updating' : 'Update'} the board and skills"${busy ? ' aria-disabled="true"' : ''}>${busy ? 'Updating…' : 'Update'}</button>`;
}

/** A success that clears itself after a few seconds; a failure stays until it's closed. */
function toast(key: string, what: string, body: string, failed = false): string {
  return `<div class="banner toast" ${failed ? 'role="alert"' : `role="status" data-expires="${esc(key)}"`}>${dismissButton(key, `: ${what}`)}${body}</div>`;
}

/** The update this page or a terminal started: its steps as they finish, then a toast or the failure. */
function updateBanner(data: BoardData, opts: RenderOptions): { banner?: string; toast?: string } {
  const view = opts.updateView;
  const update = data.codeUpdate;
  const shown = (key: string) => !opts.dismissed?.has(key);
  if (view?.phase === 'lost' && update) {
    if (!shown('lost')) return {};
    return { banner: `<div class="banner" role="alert">${dismissButton('lost', ": the board didn't restart")}<strong>The board didn't restart.</strong> Check <code>${esc(update.logs.board)}</code> and <code>${esc(update.logs.update)}</code>, then run <code>${esc(update.command)}</code> in a terminal. <button type="button" class="copy" data-copy="${esc(update.command)}" aria-label="Copy board update command">Copy</button></div>` };
  }
  if (view?.phase === 'refused' && shown('refused')) {
    return { banner: `<div class="banner" role="alert">${dismissButton('refused', ": the update didn't start")}<strong>The update didn't start.</strong> ${esc(view.message)}</div>` };
  }
  const progress = data.update;
  if (!progress) return {};
  const key = `update-${progress.finishedAt}`;
  if (progress.state !== 'running' && !shown(key)) return {};
  // A failure stays until it is closed or the next update replaces it; a success clears.
  const finishedAt = progress.finishedAt ? Date.parse(progress.finishedAt) : NaN;
  if (progress.state === 'done' && !(opts.now - finishedAt <= UPDATE_RESULT_MS)) return {};
  const current = progress.current
    ? `<li class="${progress.state === 'failed' ? 'failed' : 'current'}" aria-current="step">${esc(progress.current)}</li>`
    : '';
  const steps = `<ol class="update-steps" aria-label="Update steps">${progress.finished.map((step) => `<li class="finished">${esc(step)}</li>`).join('')}${current}</ol>`;
  if (progress.state === 'running') {
    return { banner: `<div class="banner update-progress" role="status"><strong>Updating the board and skills…</strong>${steps}</div>` };
  }
  if (progress.state === 'done') {
    const result = progress.finished.includes('restart') && progress.revision
      ? `The board now runs <code>${esc(progress.revision.slice(0, 7))}</code>, with the skills and checklists from main.`
      : 'The board was already current; the skills and checklists are updated from main.';
    return { toast: toast(key, 'update finished', `<strong>Update finished.</strong> ${result}`) };
  }
  const step = progress.current && progress.current in UPDATE_HINTS ? progress.current : 'done';
  const tail = progress.logTail ? `<pre class="update-log">${esc(progress.logTail)}</pre>` : '';
  const log = update ? ` Full log: <code>${esc(update.logs.update)}</code>` : '';
  return { banner: `<div class="banner update-progress" role="alert">${dismissButton(key, ': update failed')}<strong>Update failed at ${esc(step)}.</strong> ${esc(progress.error ?? '')}${steps}${tail}<p class="update-hint">${esc(UPDATE_HINTS[step])}${log}</p></div>` };
}

function noticeToast(notice: Notice): string {
  const { key, item } = notice;
  switch (notice.verb) {
    // The issue is gone, so there is nothing to link to.
    case 'Abandoned':
      return toast(key, `${notice.verb} ${ref(item)}`, esc(abandonPrompt(item).done));
    case 'Failed':
      return toast(key, `error for ${ref(item)}`, `Couldn't ${notice.to ? `move ${titleLink(item)} to ${esc(notice.to)}` : `abandon ${titleLink(item)}`}. ${esc(notice.message)}`, true);
    case 'Started': {
      // T3 titles a thread after line 1 of the work message; don't repeat the issue.
      const title = notice.thread.title === workTitle(item) ? '' : ` <b>${esc(notice.thread.title)}</b>`;
      return toast(key, `started ${ref(item)}`, `Started T3 thread${title} <code class="thread-id">${esc(notice.thread.threadId)}</code> for ${titleLink(item)}.`);
    }
    default:
      return toast(key, `${notice.verb} ${ref(item)}`, `${notice.verb} ${titleLink(item)} to ${esc(notice.to)}. <button type="button" class="copy view-item" data-view-item="${esc(item.id)}">View item</button>`);
  }
}

// ---------- tool notices ----------

/** A Recheck's answer: the error when it failed, else null, and the tool problems it left, serialised. */
export interface RecheckAnswer {
  error: string | null;
  tools: string;
}

export function recheckAnswer(error: string | null, data: BoardData): RecheckAnswer {
  return { error, tools: JSON.stringify(data.tools ?? {}) };
}

/**
 * The answer while the tool problems are still the ones it answered, else undefined, so an old note never heads a new notice.
 * `fresh` marks board data just in from the server, which answers a failed Recheck's "can't reach" too, so its error note goes.
 */
export function answeredRecheck(answer: RecheckAnswer | undefined, data: BoardData, fresh = false): RecheckAnswer | undefined {
  if (fresh && answer?.error) return undefined;
  return answer?.tools === JSON.stringify(data.tools ?? {}) ? answer : undefined;
}

/** The Recheck button and, once a Recheck answered with the notice still up, what it found. */
function recheckButton(problem: ToolProblem, opts: RenderOptions): string {
  const button = `<button type="button" class="copy recheck" data-recheck${opts.rechecking ? ' disabled' : ''}>${opts.rechecking ? 'Checking…' : 'Recheck'}</button>`;
  if (opts.rechecking || !opts.rechecked) return button;
  const note = opts.rechecked.error ?? (problem.problem === 'logged-out' ? 'Still logged out.' : 'Still not found.');
  return `${button} <span class="recheck-note" role="status">${esc(note)}</span>`;
}

function copyableCommand(command: string): string {
  return `<code>${esc(command)}</code> <button type="button" class="copy" data-copy="${esc(command)}" aria-label="Copy ${esc(command)}">Copy</button>`;
}

/** How to fix an override that points at nothing runnable, or null when no override is to blame. */
function overrideFix(problem: ToolProblem, tool: string, what: string): string | null {
  if (problem.problem !== 'missing' || !problem.override) return null;
  const variable = problem.override.split('=')[0]!;
  return `No runnable <code>${tool}</code> is at <code>${esc(problem.override)}</code>. Point ${esc(variable)} at ${what} or unset it, then press Recheck.`;
}

const LOOKS_AGAIN = 'The board also looks again every 10 seconds.';

/** The full-window notice that replaces the board while no t3 is found. */
function renderT3Missing(problem: ToolMissing, opts: RenderOptions): string {
  const fix = overrideFix(problem, 't3', 'the T3 Code CLI')
    ?? "The board starts threads through T3 Code's <code>t3</code> command and didn't find it on the login shell's PATH, in /opt/homebrew/bin or in /usr/local/bin. Install T3 Code, then press Recheck.";
  return `<main class="tool-missing">
<div class="tool-missing-box" role="alert">
<h1>${BRAND_MARK}<span>T3 Code not found</span></h1>
<p>${fix} ${LOOKS_AGAIN}</p>
<p>${recheckButton(problem, opts)}</p>
</div>
</main>`;
}

/** The banner for a missing or logged-out gh, which stops the board reading GitHub. */
function ghBanner(problem: ToolProblem, opts: RenderOptions): string {
  const message = problem.problem === 'logged-out'
    ? `<strong>GitHub CLI is logged out.</strong> The board reads the project through <code>gh</code>. Run ${copyableCommand('gh auth login')} in a terminal, then press Recheck.`
    : `<strong>GitHub CLI not found.</strong> The board reads the project through <code>gh</code>. ${overrideFix(problem, 'gh', 'gh')
      ?? `Install it with ${copyableCommand('brew install gh')}, then press Recheck.`}`;
  return `<div class="banner" role="alert">${message} ${LOOKS_AGAIN} ${recheckButton(problem, opts)}</div>`;
}

export function renderHeader(data: BoardData, opts: RenderOptions): string {
  const counts = countsOf(data);
  const refreshed = data.fetchedAt
    ? `Refreshed <time datetime="${esc(data.fetchedAt)}">${clock(data.fetchedAt, opts.timeZone)}</time> <span class="age">(${ago(data.fetchedAt, opts.now)})</span>`
    : 'Not read yet';
  const banners: string[] = [];
  const update = data.codeUpdate;
  const behind = (update?.behind ?? 0) > 0;
  // While an update runs, its progress replaces the notice and the control returns to the title row.
  const running = data.update?.state === 'running' && opts.updateView?.phase !== 'lost';
  const onBanner = Boolean(update?.updatable) && behind && !running;
  if (update && behind && (onBanner || !update.updatable)) {
    banners.push(update.updatable
      ? `<div class="banner code-update" role="status"><strong>Board update available.</strong> ${updateButton(data, opts)}</div>`
      : `<div class="banner code-update" role="status"><strong>Board update available.</strong> Run <code>${esc(update.command)}</code> <button type="button" class="copy" data-copy="${esc(update.command)}" aria-label="Copy board update command">Copy</button></div>`);
  }
  const progress = updateBanner(data, opts);
  if (progress.banner) banners.push(progress.banner);
  if (update && (update.error || update.behind === null)) {
    banners.push(`<div class="banner" role="status"><strong>${update.error ? 'Board update check failed.' : 'Checking for board updates…'}</strong>${update.error ? ` ${esc(update.error)}` : ''}</div>`);
  }
  const toasts = [progress.toast, opts.notice && noticeToast(opts.notice)].filter(Boolean);
  if (opts.clientError && !opts.dismissed?.has('client-error')) {
    banners.push(
      `<div class="banner" role="alert">${dismissButton('client-error', ": can't reach the board server")}<strong>Can't reach the board server.</strong> ${esc(opts.clientError)} Showing the last data this page received.</div>`,
    );
  }
  // A gh that can't read explains the old data itself.
  if (data.tools?.gh) banners.push(ghBanner(data.tools.gh, opts));
  else if (isStale(data, opts.now)) {
    const since = data.fetchedAt
      ? `Showing data from ${clock(data.fetchedAt, opts.timeZone)} (${ago(data.fetchedAt, opts.now)}).`
      : 'No data yet.';
    const why = data.error
      ? ` The last read through <code>gh</code> failed: <code class="err">${esc(data.error)}</code>`
      : ' The server has not refreshed it in a while.';
    banners.push(`<div class="banner" role="alert"><strong>Stale.</strong> ${since}${why}</div>`);
  }
  const project = data.project.url
    ? `<a href="${esc(data.project.url)}" target="_blank" rel="noopener">${esc(data.project.title)} project</a>`
    : esc(data.project.title);
  return `<header class="top">
<div class="title-row"><h1>${BRAND_MARK}<span>factory</span></h1><p class="refreshed">${refreshed} · ${project}</p><span class="header-actions"><button type="button" class="copy add-item" data-add-item>Add item</button>${update?.updatable && !onBanner ? updateButton(data, opts) : ''}</span></div>
<ul class="totals" aria-label="Counts">
<li class="${counts.needsYou ? 'amber' : ''}"><b>${counts.needsYou}</b> need you</li>
<li><b>${counts.inFlight}</b> in flight</li>
<li><b>${counts.queued}</b> queued</li>
<li><b>${counts.list}</b> in List</li>
<li><b>${counts.total}</b> items</li>
</ul>
${banners.join('\n')}
<div class="toasts">${toasts.map((t) => `\n${t}`).join('')}</div>
</header>`;
}

/** What Abandon asks before it deletes, and what it says after. */
export function abandonPrompt(item: Item): { question: string; detail: string; confirm: string; done: string } {
  return item.type === 'DraftIssue'
    ? { question: `Remove draft ${item.title}?`, detail: "This removes the draft from the project. It can't be undone.",
        confirm: 'Remove draft', done: `Removed draft ${item.title}.` }
    : { question: `Delete ${ref(item)} ${item.title}?`, detail: `This permanently deletes the issue from ${item.repo} on GitHub. It can't be undone.`,
        confirm: 'Delete issue', done: `Deleted ${ref(item)} ${item.title}.` };
}

/** Abandon's confirmation. The page fills in the item; it stays outside the polling render area. */
export function renderAbandonDialog(): string {
  return `<dialog id="abandon-dialog" aria-labelledby="abandon-heading" aria-describedby="abandon-detail">
<div class="form-heading"><h2 id="abandon-heading"></h2></div>
<p class="form-hint" id="abandon-detail"></p>
<div class="form-actions"><button type="button" class="copy" data-abandon-cancel autofocus>Cancel</button><button type="button" class="copy abandon" data-abandon-confirm></button></div>
</dialog>`;
}

/** A stable dialog outside the board's polling render area. */
export function renderAddItemForm(data: BoardData): string {
  const groups = data.repos.map((repo, index) => {
    const choices = applicability(repo.platform);
    if (!choices.length) return '';
    return `<div data-applicability="${esc(repo.repo)}"${index ? ' hidden' : ''}>${choices.map((group, g) =>
      `<fieldset class="applicability" aria-describedby="item-hint-${index}-${g}"><legend>${esc(group.title)}</legend>
<div class="choices">${group.labels.map((label) => `<label><input type="checkbox" name="labels" value="${esc(label)}"${index ? ' disabled' : ''}> ${esc(label)}</label>`).join('')}</div>
<p class="form-hint" id="item-hint-${index}-${g}">${esc(group.hint)}</p></fieldset>`).join('')}</div>`;
  }).join('');
  return `<dialog id="add-item-dialog" aria-labelledby="add-item-heading">
<form id="add-item-form" novalidate>
<div class="form-heading"><h2 id="add-item-heading">Add item</h2><button type="button" class="copy" data-close-item>Close</button></div>
<p class="form-hint">Create an issue in ${esc(data.project.title)} and add it to List.</p>
<fieldset id="item-fields" class="item-fields">
<div class="form-pair"><div class="form-field"><label for="item-repo">Repository</label><select id="item-repo" name="repo" required>${data.repos.map((r) => `<option value="${esc(r.repo)}">${esc(r.platform)}</option>`).join('')}</select></div>
<div class="form-field"><label for="item-kind">Kind</label><select id="item-kind" name="kind" required><option value="">Choose a kind</option>${ITEM_KINDS.map((kind) => `<option value="${kind}">${kind}</option>`).join('')}</select></div></div>
${groups}
<div class="form-field"><label for="item-title">Title <span class="required-note">(required)</span></label><input id="item-title" name="title" required maxlength="256" autocomplete="off"></div>
<div class="form-field"><label for="item-description">Description <span class="required-note">(optional)</span></label><textarea id="item-description" name="description" rows="4" maxlength="65536"></textarea></div>
</fieldset>
<div id="item-result" role="status" aria-live="polite" aria-atomic="true"></div>
<div class="form-actions"><button type="submit" class="copy submit-item" id="item-submit">Add to List</button><button type="button" class="copy" id="item-new" hidden>Start a new item</button></div>
</form>
</dialog>`;
}

// ---------- board view ----------

function conceptBlock(concept: Item, data: BoardData, opts: RenderOptions): string {
  const children = data.items
    .filter(
      (i) =>
        i.parent &&
        i.parent.repo === concept.repo &&
        i.parent.number === concept.number &&
        i.status !== 'Done' &&
        i.state !== 'CLOSED' &&
        i.state !== 'MERGED',
    )
    .sort(byFlowOrder);
  const { total, completed } = concept.subIssues;
  const pct = total ? Math.round((completed / total) * 100) : 0;
  const progress = `<div class="progress"><div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${completed}" aria-label="Sub-issues done"><span style="width:${pct}%"></span></div><span class="progress-label">${completed}/${total} sub-issues done</span></div>`;
  const groups = STATUSES.filter((s) => children.some((c) => c.status === s))
    .map((s) => {
      const list = children.filter((c) => c.status === s);
      const amber = AMBER_STATUSES.includes(s) ? ' amber' : '';
      return `<li class="sub-group"><span class="sub-status${amber}">${esc(s)}</span><ul>${list
        .map((c) =>
          row(c, data, c.blockedBy ? `<span class="blocked-by">blocked by ${c.blockedBy}</span>` : '', true, 'kind'),
        )
        .join('')}</ul></li>`;
    })
    .join('');
  const open = children.length
    ? `<ul class="sub-groups" aria-label="Open sub-issues by status">${groups}</ul>`
    : '<p class="empty">No open sub-issues on the board.</p>';
  return card(concept, data, opts, `${progress}${open}`);
}

export function renderBoardView(data: BoardData, opts: RenderOptions): string {
  const { now, ui } = opts;
  const items = [...data.items].sort(byFlowOrder);
  const inStatus = (...s: Status[]) => items.filter((i) => s.includes(i.status));

  const needsYou = inStatus('Needs you', 'Verify', 'Ready to merge');
  const inFlight = inStatus('Shaping', 'Ready', 'In progress', 'Review').filter(
    (i) => kindOf(i) !== 'concept',
  );
  const concepts = items.filter((i) => kindOf(i) === 'concept' && i.status !== 'Done');
  const queued = inStatus('Queued');
  const list = inStatus('List');
  const done = items
    .filter((i) => isRecentlyDone(i, now))
    .sort((a, b) => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt));

  // Issues and drafts get a footer row; nothing queues a pull request, so it gets none.
  // A Start in flight, uncertain or done takes the row away.
  const footer = (i: Item) =>
    i.type === 'PullRequest' || startHolds(i, data, opts.actions?.[i.id]) ? '' : `<div class="card-actions">${backToListButton(i, data, opts.actions?.[i.id])}${abandonButton(i, data, opts.actions?.[i.id], 'link-action danger')}</div>`;
  const queuedExtra = (i: Item) =>
    (workMessage(i)
      ? startControl(i, data, opts.actions?.[i.id], ui).message
      : '<p class="foot"><span class="hint">This draft needs an issue before it can start. Convert it to an issue in a repo.</span></p>');
  // A group, so Start sits in the card's top-right corner.
  const queuedAction = (i: Item) =>
    workMessage(i) ? `<span class="start-group">${startControl(i, data, opts.actions?.[i.id], ui).button}</span>` : '';

  const platforms = [...data.repos.map((r) => r.platform)];
  for (const i of list) {
    const p = platformOf(i, data.repos);
    if (!platforms.includes(p)) platforms.push(p);
  }
  const listBody = `<div class="platforms">${platforms
    .map((p) => {
      const mine = list.filter((i) => platformOf(i, data.repos) === p);
      const id = listGroupId(p);
      const body = mine.length
        ? `<ul class="rows">${mine.map((i) => row(i, data, queueButton(i, data, opts.actions?.[i.id]) + abandonButton(i, data, opts.actions?.[i.id]) + actionError(i, opts.actions?.[i.id]), false)).join('')}</ul>`
        : '<p class="empty">Nothing in List.</p>';
      return `<details class="platform" id="${id}"${isOpen(ui, id, true)}><summary><span class="plat plat-${esc(slug(p))}">${esc(p)}</span> <b>${mine.length}</b> in List</summary>${body}</details>`;
    })
    .join('')}</div>`;

  const doneBody = `<details class="platform" id="done-list"${isOpen(ui, 'done-list', false)}><summary>Show ${plural(done.length, 'item')} closed in the last 7 days</summary>${
    done.length
      ? `<ul class="rows">${done
          .map((i) =>
            row(
              i,
              data,
              `${statsBadge(i)}${totalBadge(i, data)}<span class="when">${day(i.closedAt ?? i.updatedAt, opts.timeZone)}</span>`,
            ),
          )
          .join('')}</ul>`
      : '<p class="empty">Nothing closed this week.</p>'
  }</details>`;

  return [
    section(
      'needs-you',
      'Needs you',
      needsYou.length,
      cards(needsYou, data, opts, 'Nothing needs you right now.'),
      'Needs you, Verify and Ready to merge: only you can move these',
    ),
    section(
      'in-flight',
      'In flight',
      inFlight.length,
      cards(inFlight, data, opts, 'Nothing is being shaped, built or reviewed.'),
      'Shaping, Ready, In progress, Review',
    ),
    section(
      'concepts',
      'Concepts',
      concepts.length,
      concepts.length
        ? `<div class="cards wide">${concepts.map((c) => conceptBlock(c, data, opts)).join('\n')}</div>`
        : '<p class="empty">No open concepts.</p>',
    ),
    section(
      'queued',
      'Queued',
      queued.length,
      cards(queued, data, opts, 'Nothing queued. Press Queue on a List item to queue it.', queuedExtra, queuedAction, footer),
      'Start opens a mux-work thread in T3 Code',
    ),
    section('list', 'List', list.length, listBody),
    section('done', 'Done', done.length, doneBody, 'last 7 days'),
  ].join('\n');
}

// ---------- flow view ----------

function issueKey(repo: string | null, number: number | null): string | null {
  return repo && number !== null ? `${repo}#${number}` : null;
}

function outlineOrder(a: Item, b: Item): number {
  return STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) || (a.number ?? 0) - (b.number ?? 0);
}

function statusChip(item: Item): string {
  const tone = AMBER_STATUSES.includes(item.status) ? ' amber' : item.status === 'Done' ? ' done' : '';
  return `<span class="o-status${tone}">${esc(item.status)}</span>`;
}

/** `#n` within the same repo, `repo#n` across repos. */
function shortRef(r: IssueRef, from: string | null): string {
  return r.repo === from ? `#${r.number}` : `${r.repo.split('/')[1]}#${r.number}`;
}

/** A Board item jumps to its own row; anything else is a dashed reference to GitHub with its state. */
function issueRefLink(r: IssueRef, from: string | null, shown: Map<string, Item>): string {
  const item = shown.get(issueKey(r.repo, r.number)!);
  const label = `<b>${esc(shortRef(r, from))}</b> ${esc(r.title)}`;
  if (item) return `<a class="o-ref" href="#flow" data-outline-jump="${esc(item.id)}">${label}</a> ${statusChip(item)}`;
  return `<a class="o-ref off" href="${esc(r.url)}" target="_blank" rel="noopener">${label}</a> <span class="o-off">not on board · ${r.state === 'OPEN' ? 'open' : 'closed'}</span>`;
}

/** One row per link GitHub returned, then a count of the rest. */
function linkRows(rel: 'blocked by' | 'blocks', links: IssueLinks, from: string | null, shown: Map<string, Item>): string {
  const cls = rel === 'blocked by' ? 'o-blocked-by' : 'o-blocks';
  const rows = links.nodes.map((r) => `<li class="o-link ${cls}"><span class="o-rel">${rel}</span> ${issueRefLink(r, from, shown)}</li>`);
  const more = links.total - links.nodes.length;
  if (more > 0) rows.push(`<li class="o-link ${cls} o-more"><span class="o-rel">${rel}</span> ${plural(more, 'more issue', 'more issues')}</li>`);
  return rows.join('');
}

/**
 * Parent/child and blocked-by links as an indented outline. Only links GitHub
 * records are shown; issues that aren't on the Board appear as references.
 */
export function renderFlowView(data: BoardData, opts: RenderOptions): string {
  const items = data.items.filter((i) => isOnBoard(i, opts.now)).sort(outlineOrder);
  const shown = new Map(items.flatMap((i) => {
    const key = issueKey(i.repo, i.number);
    return key ? [[key, i] as const] : [];
  }));
  const parentKey = (i: Item) => (i.parent ? issueKey(i.parent.repo, i.parent.number) : null);
  const children = new Map<string, Item[]>();
  for (const i of items) {
    const key = parentKey(i);
    if (key) children.set(key, [...(children.get(key) ?? []), i]);
  }

  const node = (i: Item): string => {
    const kids = children.get(issueKey(i.repo, i.number) ?? '') ?? [];
    // A build's slices are never board items and aren't in its sub-issue counts, so none is missing.
    const missing = i.subIssues.total - kids.length;
    const kidRows = kids.map(node).join('')
      + (missing > 0 ? `<li class="o-missing">${plural(missing, 'more sub-issue')} not on the board</li>` : '');
    const links = linkRows('blocked by', i.blockers, i.repo, shown) + linkRows('blocks', i.blocking, i.repo, shown);
    const count = subsDone(i);
    const subs = count ? `<span class="o-subs">${count}</span>` : '';
    return `<li class="o-node" id="o-${esc(i.id)}">
<div class="o-row" data-anchor="o:${esc(i.id)}">${platformBadge(i, data)}${kindPill(i)}${titleLink(i, 'o-title')}${statusChip(i)}${subs}</div>
${links ? `<ul class="o-links">${links}</ul>` : ''}${kidRows ? `<ul class="o-tree">${kidRows}</ul>` : ''}</li>`;
  };

  const related = (i: Item) => Boolean(i.parent || i.subIssues.total || i.slices.length || i.blockers.total || i.blocking.total);
  const roots: Item[] = [];
  const offBoard = new Map<string, { parent: IssueRef; kids: Item[] }>();
  for (const i of items.filter(related)) {
    const key = parentKey(i);
    if (!key) roots.push(i);
    else if (!shown.has(key)) offBoard.set(key, { parent: i.parent!, kids: [...(offBoard.get(key)?.kids ?? []), i] });
  }
  const offRoots = [...offBoard.values()].map(({ parent, kids }) => `<li class="o-node o-offroot">
<div class="o-row">${issueRefLink(parent, null, shown)}</div>
<ul class="o-tree">${kids.map(node).join('')}</ul></li>`).join('');
  const loose = items.filter((i) => !related(i));
  const looseRows = loose.map((i) => `<li class="row-item" data-anchor="o:${esc(i.id)}">${platformBadge(i, data)}${titleLink(i, 'row-title')}${statusChip(i)}</li>`).join('');

  return `<div class="outline">
<ul class="o-legend" aria-label="Legend"><li><span class="o-rel">nested</span> sub-issue of the row above</li><li><span class="o-rel">blocked by</span> GitHub's blocked-by link</li><li><span class="o-rel">blocks</span> GitHub's blocking link</li><li><span class="o-ref off">dashed</span> not on the board, shown as a reference</li></ul>
<ul class="o-tree o-root">${roots.map(node).join('')}${offRoots}</ul>
<details class="platform o-loose" id="flow-loose"${isOpen(opts.ui, 'flow-loose', false)}><summary>${plural(loose.length, 'item')} with no recorded relationships</summary><ul class="rows">${looseRows}</ul></details>
</div>`;
}

// ---------- the whole app ----------

export function renderApp(data: BoardData, opts: RenderOptions): string {
  if (data.tools?.t3) return renderT3Missing(data.tools.t3, opts);
  const { view } = opts.ui;
  const tab = (v: View, label: string) =>
    `<button type="button" role="tab" class="vtab" id="tab-${v}" data-view="${v}" aria-controls="panel-${v}" aria-selected="${view === v}" tabindex="${view === v ? 0 : -1}">${label}</button>`;
  return `${renderHeader(data, opts)}
<nav class="vtabs" role="tablist" aria-label="Views">${tab('board', 'Board')}${tab('flow', 'Flow')}</nav>
<main>
<div class="panel" role="tabpanel" id="panel-board" aria-labelledby="tab-board"${view === 'board' ? '' : ' hidden'}>
${renderBoardView(data, opts)}
</div>
<div class="panel" role="tabpanel" id="panel-flow" aria-labelledby="tab-flow"${view === 'flow' ? '' : ' hidden'}>
${renderFlowView(data, opts)}
</div>
</main>`;
}
