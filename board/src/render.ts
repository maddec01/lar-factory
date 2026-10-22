// The board's fixed template. Pure functions from data to HTML strings, shared
// by the server (initial page, tests) and the browser (re-render every 15 s).

import {
  AMBER_STATUSES,
  STATUSES,
  canAbandon,
  checkState,
  countsOf,
  isOnBoard,
  isRecentlyDone,
  isSlow,
  isStale,
  kindLabel,
  kindOf,
  platformOf,
  ref,
  workMessage,
  workTitle,
} from './model.ts';
import type { BoardData, IssueLinks, IssueRef, Item, LinkedPr, StartedThread, Status, UpdateStep } from './model.ts';
import { applicability, ITEM_KINDS } from './add-item.ts';

export type View = 'board' | 'flow';

export interface UiState {
  view: View;
  /** Open or closed, by <details> id, for the ones the user toggled since the page loaded. */
  toggled: Record<string, boolean>;
}

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
}

export type Notice = { key: string } & (
  | { verb: 'Added' | 'Moved'; item: Item; to: Status }
  | { verb: 'Abandoned'; item: Item }
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
  /** Set for Abandon; Queue and Start leave it unset. */
  kind?: 'abandon';
  message?: string;
  thread?: StartedThread;
}

/** The Mux logo: viewBox and path copied unchanged from mux-server's BrandMark.tsx. */
export const BRAND_MARK = '<svg class="brand-mark" role="img" aria-label="Mux" viewBox="0 0 56 32" fill="none"><path d="M5 3.5v25M5 3.5V12a8.5 8.5 0 0 0 17 0V3.5M22 12c0 4.5 2 7.5 5.5 7.5M36 3.5l14 17M50 3.5l-14 17" stroke="currentColor" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

export const DEFAULT_UI: UiState = { view: 'board', toggled: {} };

// ---------- small helpers ----------

export function esc(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function clock(iso: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone }).format(
    new Date(iso),
  );
}

function day(iso: string, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone }).format(
    new Date(iso),
  );
}

export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** A running time in whole minutes: `12m`, `1h 5m`. */
function elapsed(iso: string, now: number): string {
  const m = Math.max(0, Math.floor((now - Date.parse(iso)) / 60_000));
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function byFlowOrder(a: Item, b: Item): number {
  return (
    STATUSES.indexOf(a.status) - STATUSES.indexOf(b.status) ||
    b.updatedAt.localeCompare(a.updatedAt) ||
    (a.repo ?? '').localeCompare(b.repo ?? '') ||
    (a.number ?? 0) - (b.number ?? 0)
  );
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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

/** Ten segments, one per status, with the item's current status highlighted. */
export function stepBar(status: Status): string {
  const at = STATUSES.indexOf(status);
  const tone = AMBER_STATUSES.includes(status) ? 'amber' : status === 'Done' ? 'done' : 'now';
  const segments = STATUSES.map((s, i) => {
    const state = i < at ? 'past' : i === at ? `cur ${tone}` : 'next';
    return `<li class="${state}" title="${esc(s)}"></li>`;
  }).join('');
  return `<div class="stepbar"><ol class="steps" aria-hidden="true">${segments}</ol><span class="step-label ${tone}">${at + 1}/${STATUSES.length} · ${esc(status)}</span></div>`;
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

/** `action` is a button for the card's top row, so it adds no height. */
function card(item: Item, data: BoardData, now: number, extra = '', action = ''): string {
  const parent = item.parent
    ? `<p class="parent">Part of <a href="${esc(item.parent.url)}" target="_blank" rel="noopener">#${item.parent.number} ${esc(item.parent.title)}</a></p>`
    : '';
  const blocked = item.blockedBy
    ? `<span class="blocked" title="Blocked by ${plural(item.blockedBy, 'issue')}">blocked by ${item.blockedBy}</span>`
    : '';
  const subs = item.subIssues.total
    ? `<span class="subs">${item.subIssues.completed}/${item.subIssues.total} ${subsNoun(item)}</span>`
    : '';
  const hint = HINTS[item.status];
  const prs = item.linkedPrs
    .map(
      (pr) =>
        `<span class="linked-pr"><a class="pr" href="${esc(pr.url)}" target="_blank" rel="noopener">PR #${pr.number}${pr.isDraft ? ' (draft)' : pr.state === 'OPEN' ? '' : ` (${esc(pr.state.toLowerCase())})`}</a>${checksBadge(pr, now)}</span>`,
    )
    .join('');
  const foot = hint || prs ? `<p class="foot">${hint ? `<span class="hint">${esc(hint)}</span>` : ''}${prs}</p>` : '';
  return `<article class="card${AMBER_STATUSES.includes(item.status) ? ' amber' : ''}" data-anchor="${esc(item.id)}">
<div class="meta">${platformBadge(item, data)}${kindPill(item)}${blocked}${subs}${action}</div>
${titleLink(item)}
${parent}${stepBar(item.status)}${foot}${sliceList(item.slices)}${extra}
</article>`;
}

/** A build's sub-issues are its slices. */
const subsNoun = (item: Item) => (kindOf(item) === 'build' ? 'slices' : 'sub-issues');

/** A build's slices, nested like a concept's sub-issues. They aren't board items, so they have no Status. */
function sliceList(slices: IssueRef[]): string {
  if (!slices.length) return '';
  const rows = slices.map((s) => {
    const closed = s.state === 'CLOSED';
    return `<li class="row-item slice${closed ? ' done' : ''}"><a class="row-title" href="${esc(s.url)}" title="${esc(s.title)}" target="_blank" rel="noopener"><span class="ref">#${s.number}</span> ${esc(s.title)}${closed ? '<span class="sr-only"> (closed)</span>' : ''}</a></li>`;
  }).join('');
  return `<ul class="sub-groups slices" aria-label="Slices"><li class="sub-group"><span class="sub-status">Slices</span><ul>${rows}</ul></li></ul>`;
}

function section(id: string, title: string, count: number, body: string, note = ''): string {
  return `<section class="section" id="${id}" aria-labelledby="${id}-h">
<h2 id="${id}-h">${esc(title)} <span class="count">${count}</span>${note ? ` <span class="note">${esc(note)}</span>` : ''}</h2>
${body}
</section>`;
}

function cards(items: Item[], data: BoardData, now: number, empty: string, extra?: (i: Item) => string, action?: (i: Item) => string): string {
  if (!items.length) return `<p class="empty">${esc(empty)}</p>`;
  return `<div class="cards">${items.map((i) => card(i, data, now, extra?.(i), action?.(i))).join('\n')}</div>`;
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
  const verb = action?.phase === 'pending' && action.kind !== 'abandon' ? 'Queuing…' : 'Queue';
  return `<button type="button" class="copy row-action" data-queue="${esc(item.id)}" aria-label="${verb} ${esc(ref(item))} ${esc(item.title)}"${writeState(data, action)}>${verb}</button>`;
}

function abandonButton(item: Item, data: BoardData, action: ItemAction | undefined): string {
  if (!canAbandon(item)) return '';
  const verb = action?.phase === 'pending' && action.kind === 'abandon' ? 'Abandoning…' : 'Abandon';
  return `<button type="button" class="copy row-action abandon" data-abandon="${esc(item.id)}" aria-label="${verb} ${esc(ref(item))} ${esc(item.title)}"${writeState(data, action)}>${verb}</button>`;
}

/** Start's button for the card's top row, and the message under the card when there is one. */
function startControl(item: Item, data: BoardData, action: ItemAction | undefined): { button: string; message: string } {
  const thread = data.started?.[item.id] ?? (action?.phase === 'started' ? action.thread : undefined);
  // The toast announces a start; the card only keeps Start from running twice.
  if (thread) return { button: `<span class="started-tag" tabindex="-1" data-start-result="${esc(item.id)}" title="T3 thread ${esc(thread.threadId)}">Started</span>`, message: '' };
  if (action?.phase === 'uncertain') {
    // Once its message is closed, a tag still says why Start is gone.
    if (!action.message) return { button: `<span class="started-tag unsure" tabindex="-1" data-start-result="${esc(item.id)}" title="Check T3 before starting it again">May have started</span>`, message: '' };
    return { button: '', message: `<p class="start" tabindex="-1" data-start-result="${esc(item.id)}">${actionError(item, action)}</p>` };
  }
  const verb = action?.phase === 'pending' ? 'Starting…' : action?.phase === 'error' ? 'Retry start' : 'Start';
  return {
    button: `<button type="button" class="copy start-item" data-start="${esc(item.id)}" aria-label="${verb} ${esc(ref(item))} ${esc(item.title)}"${writeState(data, action)}>${verb}</button>`,
    message: action?.phase === 'error' ? `<p class="start">${actionError(item, action)}</p>` : '',
  };
}

// ---------- header ----------

function updateButton(data: BoardData, opts: RenderOptions): string {
  const busy = opts.updateView?.phase === 'starting' || (data.update?.state === 'running' && opts.updateView?.phase !== 'lost');
  return `<button type="button" class="copy" data-update aria-label="${busy ? 'Updating' : 'Update'} the board and skills"${busy ? ' aria-disabled="true"' : ''}>${busy ? 'Updating…' : 'Update'}</button>`;
}

/** A success that clears itself: the page closes it after a few seconds. */
function toast(key: string, what: string, body: string): string {
  return `<div class="banner toast" role="status" data-expires="${esc(key)}">${dismissButton(key, `: ${what}`)}${body}</div>`;
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
    case 'Started': {
      // T3 titles a thread after line 1 of the work message; don't repeat the issue.
      const title = notice.thread.title === workTitle(item) ? '' : ` <b>${esc(notice.thread.title)}</b>`;
      return toast(key, `started ${ref(item)}`, `Started T3 thread${title} <code class="thread-id">${esc(notice.thread.threadId)}</code> for ${titleLink(item)}.`);
    }
    default:
      return toast(key, `${notice.verb} ${ref(item)}`, `${notice.verb} ${titleLink(item)} to ${esc(notice.to)}. <button type="button" class="copy view-item" data-view-item="${esc(item.id)}">View item</button>`);
  }
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
  if (isStale(data, opts.now)) {
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

function conceptBlock(concept: Item, data: BoardData, now: number): string {
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
          row(c, data, c.blockedBy ? `<span class="blocked">blocked by ${c.blockedBy}</span>` : '', true, 'kind'),
        )
        .join('')}</ul></li>`;
    })
    .join('');
  const open = children.length
    ? `<ul class="sub-groups" aria-label="Open sub-issues by status">${groups}</ul>`
    : '<p class="empty">No open sub-issues on the board.</p>';
  return card(concept, data, now, `${progress}${open}`);
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

  const queuedExtra = (i: Item) => {
    const cmd = workMessage(i);
    if (!cmd) return '<p class="foot"><span class="hint">This draft needs an issue before it can start. Convert it to an issue in a repo.</span></p>';
    return `${startControl(i, data, opts.actions?.[i.id]).message}<div class="cmd"><code>${esc(cmd)}</code><button type="button" class="copy" data-copy="${esc(cmd)}" aria-label="Copy ${esc(cmd)}">Copy</button></div>`;
  };
  const queuedAction = (i: Item) => (workMessage(i) ?startControl(i, data, opts.actions?.[i.id]).button : '');

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
              `<span class="when">${day(i.closedAt ?? i.updatedAt, opts.timeZone)}</span>`,
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
      cards(needsYou, data, now, 'Nothing needs you right now.'),
      'Needs you, Verify and Ready to merge: only you can move these',
    ),
    section(
      'in-flight',
      'In flight',
      inFlight.length,
      cards(inFlight, data, now, 'Nothing is being shaped, built or reviewed.'),
      'Shaping, Ready, In progress, Review',
    ),
    section(
      'concepts',
      'Concepts',
      concepts.length,
      concepts.length
        ? `<div class="cards wide">${concepts.map((c) => conceptBlock(c, data, now)).join('\n')}</div>`
        : '<p class="empty">No open concepts.</p>',
    ),
    section(
      'queued',
      'Queued',
      queued.length,
      cards(queued, data, now, 'Nothing queued. Press Queue on a List item to queue it.', queuedExtra, queuedAction),
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
  const cls = rel === 'blocked by' ? 'blocked-by' : 'blocks';
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
    // A build's slices never join the project, so they aren't missing from it.
    const missing = kindOf(i) === 'build' ? 0 : i.subIssues.total - kids.length;
    const kidRows = kids.map(node).join('')
      + (missing > 0 ? `<li class="o-missing">${plural(missing, 'more sub-issue')} not on the board</li>` : '');
    const links = linkRows('blocked by', i.blockers, i.repo, shown) + linkRows('blocks', i.blocking, i.repo, shown);
    const subs = i.subIssues.total ? `<span class="o-subs">${i.subIssues.completed}/${i.subIssues.total} ${subsNoun(i)} done</span>` : '';
    return `<li class="o-node" id="o-${esc(i.id)}">
<div class="o-row" data-anchor="o:${esc(i.id)}">${platformBadge(i, data)}${kindPill(i)}${titleLink(i, 'o-title')}${statusChip(i)}${subs}</div>
${links ? `<ul class="o-links">${links}</ul>` : ''}${kidRows ? `<ul class="o-tree">${kidRows}</ul>` : ''}</li>`;
  };

  const related = (i: Item) => Boolean(i.parent || i.subIssues.total || i.blockers.total || i.blocking.total);
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
