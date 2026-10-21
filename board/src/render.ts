// The board's fixed template. Pure functions from data to HTML strings, shared
// by the server (initial page, tests) and the browser (re-render every 15 s).

import {
  AMBER_STATUSES,
  STATUSES,
  countsOf,
  flowNodeOf,
  isRecentlyDone,
  isStale,
  kindLabel,
  kindOf,
  platformOf,
  ref,
  trackOf,
  workCommand,
} from './model.ts';
import type { BoardData, FlowNode, Item, StartedThread, Status, Track } from './model.ts';
import { applicability, ITEM_KINDS } from './add-item.ts';

export type View = 'board' | 'flow';
export type FlowTab = 'all' | 'bug' | 'feat' | 'vis' | 'fog';

export interface UiState {
  view: View;
  flowTab: FlowTab;
  /** ids of <details> elements the user opened. */
  open: string[];
}

export interface RenderOptions {
  now: number;
  /** IANA time zone for clock times; undefined means the runtime's own. */
  timeZone?: string;
  ui: UiState;
  /** Set by the browser when it can't reach the board server. */
  clientError?: string | null;
  /** The item this page just added or moved, announced in the header. */
  notice?: { verb: 'Added' | 'Moved'; item: Item; to: Status } | null;
  /** Per item id: what this page is doing for the item. */
  actions?: Record<string, ItemAction>;
}

/** An action this page started for an item: in flight, failed, or (for Start) done. */
export interface ItemAction {
  phase: 'pending' | 'error' | 'uncertain' | 'started';
  message?: string;
  thread?: StartedThread;
}

export const DEFAULT_UI: UiState = { view: 'board', flowTab: 'all', open: [] };

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

function isOpen(ui: UiState, id: string): string {
  return ui.open.includes(id) ? ' open' : '';
}

// ---------- shared bits ----------

function platformBadge(item: Item, data: BoardData): string {
  const platform = platformOf(item, data.repos);
  return `<span class="plat plat-${esc(slug(platform))}">${esc(platform)}</span>`;
}

function kindPill(item: Item): string {
  return `<span class="kind kind-${kindOf(item)}">${esc(kindLabel(item))}</span>`;
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

const HINTS: Partial<Record<Status, string>> = {
  'Needs you': 'Answer in its shaping thread',
  Verify: 'Test it with the steps in the PR, then merge',
  'Ready to merge': 'Merge the PR',
};

/** `action` is a button for the card's top row, so it adds no height. */
function card(item: Item, data: BoardData, extra = '', action = ''): string {
  const parent = item.parent
    ? `<p class="parent">Part of <a href="${esc(item.parent.url)}" target="_blank" rel="noopener">#${item.parent.number} ${esc(item.parent.title)}</a></p>`
    : '';
  const blocked = item.blockedBy
    ? `<span class="blocked" title="Blocked by ${plural(item.blockedBy, 'issue')}">blocked by ${item.blockedBy}</span>`
    : '';
  const subs = item.subIssues.total
    ? `<span class="subs">${item.subIssues.completed}/${item.subIssues.total} sub-issues</span>`
    : '';
  const hint = HINTS[item.status];
  const prs = item.linkedPrs
    .map(
      (pr) =>
        `<a class="pr" href="${esc(pr.url)}" target="_blank" rel="noopener">PR #${pr.number}${pr.isDraft ? ' (draft)' : pr.state === 'OPEN' ? '' : ` (${esc(pr.state.toLowerCase())})`}</a>`,
    )
    .join('');
  const foot = hint || prs ? `<p class="foot">${hint ? `<span class="hint">${esc(hint)}</span>` : ''}${prs}</p>` : '';
  return `<article class="card${AMBER_STATUSES.includes(item.status) ? ' amber' : ''}">
<div class="meta">${platformBadge(item, data)}${kindPill(item)}${blocked}${subs}${action}</div>
${titleLink(item)}
${parent}${stepBar(item.status)}${foot}${extra}
</article>`;
}

function section(id: string, title: string, count: number, body: string, note = ''): string {
  return `<section class="section" id="${id}" aria-labelledby="${id}-h">
<h2 id="${id}-h">${esc(title)} <span class="count">${count}</span>${note ? ` <span class="note">${esc(note)}</span>` : ''}</h2>
${body}
</section>`;
}

function cards(items: Item[], data: BoardData, empty: string, extra?: (i: Item) => string, action?: (i: Item) => string): string {
  if (!items.length) return `<p class="empty">${esc(empty)}</p>`;
  return `<div class="cards">${items.map((i) => card(i, data, extra?.(i), action?.(i))).join('\n')}</div>`;
}

function row(item: Item, data: BoardData, trailing = '', withPlatform = true): string {
  return `<li class="row-item">${withPlatform ? platformBadge(item, data) : ''}${titleLink(item, 'row-title')}${kindPill(item)}${trailing}</li>`;
}

function actionError(action: ItemAction | undefined): string {
  return action?.phase === 'error' || action?.phase === 'uncertain'
    ? `<span class="action-error" role="alert">${esc(action.message)}</span>`
    : '';
}

/** Board writes are off in sample mode, so its buttons are too. */
function writeState(data: BoardData, action: ItemAction | undefined): string {
  if (data.capture?.enabled === false) return ' disabled title="Disabled in sample mode"';
  return action?.phase === 'pending' ? ' aria-disabled="true"' : '';
}

function queueButton(item: Item, data: BoardData, action: ItemAction | undefined): string {
  const verb = action?.phase === 'pending' ? 'Queuing…' : 'Queue';
  return `${actionError(action)}<button type="button" class="copy row-action" data-queue="${esc(item.id)}" aria-label="${verb} ${esc(ref(item))} ${esc(item.title)}"${writeState(data, action)}>${verb}</button>`;
}

/** Start's button for the card's top row, and the message under the card when there is one. */
function startControl(item: Item, data: BoardData, action: ItemAction | undefined): { button: string; message: string } {
  const thread = data.started?.[item.id] ?? (action?.phase === 'started' ? action.thread : undefined);
  if (thread) {
    // T3 titles a thread after its first message; don't repeat the command shown below.
    const title = thread.title === workCommand(item) ? '' : ` <b>${esc(thread.title)}</b>`;
    return { button: '', message: `<p class="start started" role="status" tabindex="-1" data-start-result="${esc(item.id)}">Started T3 thread${title} <code class="thread-id">${esc(thread.threadId)}</code></p>` };
  }
  if (action?.phase === 'uncertain') return { button: '', message: `<p class="start" tabindex="-1" data-start-result="${esc(item.id)}">${actionError(action)}</p>` };
  const verb = action?.phase === 'pending' ? 'Starting…' : action?.phase === 'error' ? 'Retry start' : 'Start';
  return {
    button: `<button type="button" class="copy start-item" data-start="${esc(item.id)}" aria-label="${verb} ${esc(ref(item))} ${esc(item.title)}"${writeState(data, action)}>${verb}</button>`,
    message: action?.phase === 'error' ? `<p class="start">${actionError(action)}</p>` : '',
  };
}

// ---------- header ----------

export function renderHeader(data: BoardData, opts: RenderOptions): string {
  const counts = countsOf(data);
  const refreshed = data.fetchedAt
    ? `Refreshed <time datetime="${esc(data.fetchedAt)}">${clock(data.fetchedAt, opts.timeZone)}</time> <span class="age">(${ago(data.fetchedAt, opts.now)})</span>`
    : 'Not read yet';
  const banners: string[] = [];
  if (opts.notice) {
    const { verb, item, to } = opts.notice;
    banners.push(`<div class="banner capture-success" role="status">${verb} ${titleLink(item)} to ${esc(to)}.</div>`);
  }
  if (opts.clientError) {
    banners.push(
      `<div class="banner" role="alert"><strong>Can't reach the board server.</strong> ${esc(opts.clientError)} Showing the last data this page received.</div>`,
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
<div class="title-row"><h1>Mux factory board</h1><p class="refreshed">${refreshed} · ${project}</p><button type="button" class="copy add-item" data-add-item>Add item</button></div>
<ul class="totals" aria-label="Counts">
<li class="${counts.needsYou ? 'amber' : ''}"><b>${counts.needsYou}</b> need you</li>
<li><b>${counts.inFlight}</b> in flight</li>
<li><b>${counts.queued}</b> queued</li>
<li><b>${counts.list}</b> in List</li>
<li><b>${counts.total}</b> items</li>
</ul>
${banners.join('\n')}
</header>`;
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

function conceptBlock(concept: Item, data: BoardData): string {
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
          row(c, data, c.blockedBy ? `<span class="blocked">blocked by ${c.blockedBy}</span>` : ''),
        )
        .join('')}</ul></li>`;
    })
    .join('');
  const open = children.length
    ? `<ul class="sub-groups" aria-label="Open sub-issues by status">${groups}</ul>`
    : '<p class="empty">No open sub-issues on the board.</p>';
  return card(concept, data, `${progress}${open}`);
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
    const cmd = workCommand(i);
    if (!cmd) return '<p class="foot"><span class="hint">This draft needs an issue before it can start. Convert it to an issue in a repo.</span></p>';
    return `${startControl(i, data, opts.actions?.[i.id]).message}<div class="cmd"><code>${esc(cmd)}</code><button type="button" class="copy" data-copy="${esc(cmd)}" aria-label="Copy ${esc(cmd)}">Copy</button></div>`;
  };
  const queuedAction = (i: Item) => (workCommand(i) ? startControl(i, data, opts.actions?.[i.id]).button : '');

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
        ? `<ul class="rows">${mine.map((i) => row(i, data, queueButton(i, data, opts.actions?.[i.id]), false)).join('')}</ul>`
        : '<p class="empty">Nothing in List.</p>';
      return `<details class="platform" id="${id}"${isOpen(ui, id)}><summary><span class="plat plat-${esc(slug(p))}">${esc(p)}</span> <b>${mine.length}</b> in List</summary>${body}</details>`;
    })
    .join('')}</div>`;

  const doneBody = `<details class="platform" id="done-list"${isOpen(ui, 'done-list')}><summary>Show ${plural(done.length, 'item')} closed in the last 7 days</summary>${
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
      cards(needsYou, data, 'Nothing needs you right now.'),
      'Needs you, Verify and Ready to merge: only you can move these',
    ),
    section(
      'in-flight',
      'In flight',
      inFlight.length,
      cards(inFlight, data, 'Nothing is being shaped, built or reviewed.'),
      'Shaping, Ready, In progress, Review',
    ),
    section(
      'concepts',
      'Concepts',
      concepts.length,
      concepts.length
        ? `<div class="cards wide">${concepts.map((c) => conceptBlock(c, data)).join('\n')}</div>`
        : '<p class="empty">No open concepts.</p>',
    ),
    section(
      'queued',
      'Queued',
      queued.length,
      cards(queued, data, 'Nothing queued. Press Queue on a List item to queue it.', queuedExtra, queuedAction),
      'Start opens a mux-work thread in T3 Code',
    ),
    section('list', 'List', list.length, listBody),
    section('done', 'Done', done.length, doneBody, 'last 7 days'),
  ].join('\n');
}

// ---------- flow view ----------

const STORIES: Record<FlowTab, string> = {
  all: 'Every item goes through the same columns. Only the shaping step differs. Pick an issue type to see its path.',
  bug: "Bug: a subagent reproduces it and finds the cause, and you're only asked if the expected behaviour is unclear. Usually no prototype and no Verify step.",
  feat: "Small feature: you're grilled in the shaping thread until there are no doubts. No prototype. It goes to Ready to merge unless it touches something risky.",
  vis: 'Visual feature: grilling plus a prototype subagent that builds variants for you to pick from. It always ends in Verify, so you see it before merging.',
  fog: 'Foggy concept: the issue becomes a map, with decision sub-issues worked one per thread. Build sub-issues appear as decisions close, and each one runs through build, review and merge on its own.',
};

const TAB_LABELS: Record<FlowTab, string> = {
  all: 'All paths',
  bug: 'Bug',
  feat: 'Small feature',
  vis: 'Visual feature',
  fog: 'Foggy concept',
};

const TAB_TRACK: Record<FlowTab, Track | null> = {
  all: null,
  bug: 'bug',
  feat: 'feat',
  vis: 'feat',
  fog: 'fog',
};

export function flowItems(data: BoardData, tab: FlowTab, now: number): Map<FlowNode, Item[]> {
  const track = TAB_TRACK[tab];
  const out = new Map<FlowNode, Item[]>();
  for (const item of [...data.items].sort(byFlowOrder)) {
    if (item.status === 'Done' && !isRecentlyDone(item, now)) continue;
    if (track && trackOf(item) !== track) continue;
    const node = flowNodeOf(item);
    out.set(node, [...(out.get(node) ?? []), item]);
  }
  return out;
}

export function renderFlowView(data: BoardData, opts: RenderOptions): string {
  const tab = opts.ui.flowTab;
  const placed = flowItems(data, tab, opts.now);
  const dim = (paths: string) => (tab !== 'all' && !paths.split(' ').includes(tab) ? ' dim' : '');

  const live = (node: FlowNode) => {
    const list = placed.get(node) ?? [];
    if (!list.length) return '';
    return `<ul class="live" aria-label="Items here">${list
      .map((i) => {
        const amber = AMBER_STATUSES.includes(i.status);
        const label = `${platformOf(i, data.repos)} ${ref(i)}: ${i.title}${amber ? ' (needs you)' : ''}`;
        const inner = `<span class="ic-plat">${esc(platformOf(i, data.repos))}</span><b>${esc(ref(i))}</b> <span class="ic-title">${esc(i.title)}</span>${amber ? '<span class="ic-you">needs you</span>' : ''}`;
        return `<li>${
          i.url
            ? `<a class="ichip${amber ? ' amber' : ''}" href="${esc(i.url)}" target="_blank" rel="noopener" title="${esc(label)}">${inner}</a>`
            : `<span class="ichip${amber ? ' amber' : ''}" title="${esc(label)}">${inner}</span>`
        }</li>`;
      })
      .join('')}</ul>`;
  };
  const n = (node: FlowNode) => {
    const c = placed.get(node)?.length ?? 0;
    return `<span class="ncount${c ? ' has' : ''}" aria-label="${plural(c, 'item')}">${c}</span>`;
  };
  const who = (text: string) => `<span class="who">${text}</span>`;
  const chips = (...names: string[]) =>
    `<div class="chips">${names.map((c) => `<span class="chip">${esc(c)}</span>`).join('')}</div>`;
  const arrow = '<div class="frow"><div></div><div class="arrow"></div></div>';

  const tabs = (Object.keys(TAB_LABELS) as FlowTab[])
    .map(
      (t) =>
        `<button type="button" class="tab" data-flow-tab="${t}" aria-pressed="${t === tab}">${TAB_LABELS[t]}</button>`,
    )
    .join('');

  return `<div class="flow">
<div class="tabs" role="group" aria-label="Issue type">${tabs}</div>
<p class="story">${esc(STORIES[tab])}</p>
<div class="legend">
<span><i class="dot" style="background:var(--you)"></i>You</span>
<span><i class="dot" style="background:var(--thread)"></i>Your shaping thread (T3)</span>
<span><i class="dot" style="background:var(--sub)"></i>Subagent, fresh context, returns a summary</span>
<span><i class="dot" style="background:var(--build)"></i>Build thread (T3, own worktree)</span>
<span><i class="ichip amber legend-chip"><b>#1</b><span class="ic-you">needs you</span></i>Live issue, waiting on you</span>
</div>

<div class="frow${dim('bug feat vis fog')}"><div class="col">List</div>
<div class="box" style="--c:var(--you)" data-node="capture">${who('You')}<h3>Capture ${n('capture')}</h3><p>Add an issue to the server or Apple list, or a draft item in the Mux Project if you don't know the repo yet.</p>${live('capture')}</div></div>
${arrow}
<div class="frow${dim('bug feat vis fog')}"><div class="col">Queued</div>
<div class="box" style="--c:var(--you)" data-node="queue">${who('You')}<h3>Queue and start ${n('queue')}</h3><p>Press Queue on a List item, then Start on its Queued card. Start opens a T3 thread that runs <code>/mux-work #123</code>. Nothing starts without this.</p>${live('queue')}</div></div>
${arrow}
<div class="frow${dim('bug feat vis fog')}"><div class="col">Shaping</div>
<div class="box" style="--c:var(--thread)">${who('Agent')}<h3>Size up</h3><p>Reads the issue, glossary and ADRs. Proposes a route in two or three lines, and you confirm it.</p>
<div class="nest"><div class="box" style="--c:var(--sub)"><h4>Explore subagent</h4><p>Reads the code involved and returns a short summary, so the shaping thread never holds whole files.</p></div></div>
${chips('mux-work', 'domain-modeling')}</div></div>
${arrow}
<div class="frow${dim('bug feat vis fog')}"><div class="col">Shaping<br>Needs you</div>
<div class="split">
<div class="box${dim('bug')}" style="--c:var(--thread)" data-node="clear"><h3>Clear ${n('clear')}</h3><p>A bug it can reproduce, or a small, defined change.</p>
<div class="nest"><div class="box" style="--c:var(--sub)"><h4>Diagnose subagent</h4><p>Reproduces the bug and finds the cause. Returns the cause and a failing test idea.</p></div></div>
${chips('diagnosing-bugs')}${live('clear')}</div>
<div class="box${dim('feat vis')}" style="--c:var(--thread)" data-node="decisions"><h3>Needs decisions ${n('decisions')}</h3><p>Fits one session. It grills you here, one question at a time, until no doubts are left.</p>
<div class="nest"><div class="box${dim('vis')}" style="--c:var(--sub)"><h4>Prototype subagent</h4><p>Builds 2 or 3 variants that differ only on the open question. You try them in the browser preview or simulator and pick one.</p></div></div>
${chips('grilling', 'domain-modeling', 'prototype')}${live('decisions')}</div>
<div class="box${dim('fog')}" style="--c:var(--thread)" data-node="foggy"><h3>Foggy ${n('foggy')}</h3><p>The issue becomes the parent. Its body is the map.</p>
<div class="map"><div>Destination</div><div>Decisions so far</div><div class="fog">Fog</div><div>Out of scope</div></div>
<div class="nest"><div class="box" style="--c:var(--sub)"><h4>Research subagents</h4><p>Run in the background. Cited findings go on a <code>research/</code> branch, linked from the sub-issue.</p></div></div>
${chips('grilling', 'research', 'domain-modeling')}${live('foggy')}</div>
</div></div>

<div class="frow${dim('fog')}"><div class="col">Concept</div>
<div class="box" style="--c:var(--thread)" data-node="concept"><h3>Working the map, one decision per thread ${n('concept')}</h3><p>Each decision sub-issue is picked up like any item, in its own fresh shaping thread, so no thread holds the whole concept. When a decision closes, its answer goes on the map and the agent creates build sub-issues for what's now clear.</p>
${live('concept')}
<div class="loop">Each build sub-issue goes through the steps below on its own, as soon as nothing blocks it. The concept is done when the fog is gone and every build has merged.</div></div></div>
${arrow}
<div class="frow${dim('bug feat vis fog')}"><div class="col">Ready</div>
<div class="box" style="--c:var(--thread)" data-node="gate">${who('Agent')}<h3>Gate, then brief ${n('gate')}</h3><p>Any unconfirmed assumption goes back to you. Then the brief is written into the issue: what to build, how to tell it's done, and the confirmed assumptions. The shaping thread ends here.</p>
<div class="nest"><div class="box" style="--c:var(--sub)"><h4>Doubt subagent</h4><p>Reads only the brief, with no history, and tries to prove it wrong or ambiguous.</p></div></div>
${chips('doubt-driven-development')}${live('gate')}</div></div>
${arrow}
<div class="frow${dim('bug feat vis fog')}"><div class="col">In progress</div>
<div class="box" style="--c:var(--build)" data-node="build">${who('Agent')}<h3>Build ${n('build')}</h3><p>A new T3 thread in its own worktree. It starts from the brief alone, not from your conversation. Test-first, with clean conventional commits.</p>
<div class="nest"><div class="box${dim('fog vis feat')}" style="--c:var(--sub)"><h4>Exploration subagent (big builds)</h4><p>Saves notes on the code involved, so the builder doesn't spend context exploring.</p></div></div>
${chips('tdd', 'developer-profile', 'codebase-design')}${live('build')}</div></div>
${arrow}
<div class="frow${dim('bug feat vis fog')}"><div class="col">Review</div>
<div class="box" style="--c:var(--build)" data-node="review"><h3>Four reviewers in parallel ${n('review')}</h3><p>Each subagent reads only the brief and the diff. If any asks for changes, the builder fixes them as fixup commits. Two rounds at most, then it goes to you.</p>
<div class="nest two">
<div class="box" style="--c:var(--sub)"><h4>Code</h4>${chips('code-review-and-quality', 'code-review')}</div>
<div class="box" style="--c:var(--sub)"><h4>Security</h4>${chips('security-and-hardening')}</div>
<div class="box" style="--c:var(--sub)"><h4>UX</h4><p>Does the flow match the brief?</p></div>
<div class="box" style="--c:var(--sub)"><h4>UI</h4><p>Browser preview or simulator.</p>${chips('frontend-ui-engineering', 'browser-testing-with-devtools')}</div>
</div>${live('review')}</div></div>
${arrow}
<div class="frow${dim('bug feat vis fog')}"><div class="col">Verify or<br>Ready to merge</div>
<div class="box" style="--c:var(--build)"><h3>Approver</h3><p>Folds the fixups in, opens the PR with a conventional title, then decides where it goes.</p>
<div class="nest two">
<div class="box${dim('vis fog')}" style="--c:var(--you)" data-node="verify">${who('You')}<h4>Verify ${n('verify')}</h4><p>It's visual, an agent couldn't check something, or it touches auth, migrations or deployment. You get test steps and links.</p>${live('verify')}</div>
<div class="box${dim('bug feat fog')}" style="--c:var(--build)" data-node="ready-to-merge"><h4>Ready to merge ${n('ready-to-merge')}</h4><p>Not visual, and every reviewer was confident.</p>${live('ready-to-merge')}</div>
</div>
${chips('pr')}</div></div>
${arrow}
<div class="frow${dim('bug feat vis fog')}"><div class="col">Done</div>
<div class="box" style="--c:var(--you)" data-node="merge">${who('You')}<h3>Merge ${n('merge')}</h3><p>You merge every PR. The issue closes and the board moves it to Done. Before the build thread closes, it suggests improvements to the skills and checks. You choose which to apply.</p>
${chips('retro')}${live('merge')}</div></div>
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
