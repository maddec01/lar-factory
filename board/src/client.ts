// Browser side: keeps the page live by fetching /api/board every 15 s (every
// second during an update) and re-rendering with the same template the server used.

import { DEFAULT_UI, abandonPrompt, listGroupId, renderApp } from './render.ts';
import type { ItemAction, Notice, UiState, UpdateView, View } from './render.ts';
import { platformOf } from './model.ts';
import type { BoardData } from './model.ts';
import { validateDraft } from './add-item.ts';
import type { CreationResult, ItemDraft } from './add-item.ts';
import type { StartResult } from './t3.ts';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

const POLL_MS = 15_000;
const UPDATE_POLL_MS = 1_000;
/** How long the board may stay away during an update before the page says it didn't restart. */
const RESTART_MS = 30_000;
/** How long a success toast stays. Failures stay until closed; warnings while their cause lasts. */
const TOAST_MS = 5_000;
const app = document.getElementById('app')!;
const bootstrap = document.getElementById('board-data');
const dialog = document.getElementById('add-item-dialog') as HTMLDialogElement;
const form = document.getElementById('add-item-form') as HTMLFormElement;
const repoSelect = form.elements.namedItem('repo') as HTMLSelectElement;

let data: BoardData = JSON.parse(bootstrap?.textContent ?? 'null');
let clientError: string | null = null;
let notice: Notice | null = null;
let noticeCount = 0;
/** Notices closed on this page. A reload shows again whatever still holds. */
const dismissed = new Set<string>();
/** Toasts whose clock is running, so a re-render neither restarts it nor replays their entrance. */
const expiring = new Set<string>();
const actions: Record<string, ItemAction> = {};
let mutationVersion = 0;
let pollSequence = 0;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let updateView: UpdateView | null = null;
let lastBoard = '';
/** The update this page follows: the session it started in, and since when the board has been away. */
let updating: { session: string | undefined; awaySince: number | null } | null = null;
const ui: UiState = {
  ...DEFAULT_UI,
  view: location.hash === '#flow' ? 'flow' : 'board',
  toggled: {},
};

function render(): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;
  const { scrollX, scrollY } = window;
  app.innerHTML = renderApp(data, { now: Date.now(), ui, clientError, notice, actions, updateView, dismissed });
  tagFocusable();
  window.scrollTo(scrollX, scrollY);
  if (focusKey) focusByKey(focusKey);
  startToastClocks();
}

function setNotice(next: DistributiveOmit<Notice, 'key'>): void {
  notice = { ...next, key: `notice-${++noticeCount}` };
}

/** Closes a notice, or a card's error (`action:<item id>`), and keeps keyboard focus on the page if it was inside. */
function dismiss(key: string): void {
  const closing = app.querySelector(`[data-dismiss="${CSS.escape(key)}"]`)?.parentElement;
  const hadFocus = Boolean(closing?.contains(document.activeElement));
  let next = '[data-add-item]';
  if (key === notice?.key) notice = null;
  else if (key.startsWith('action:')) {
    const itemId = key.slice('action:'.length);
    const action = actions[itemId];
    // An unconfirmed start keeps its phase, so Start stays hidden; only the message goes.
    if (action?.phase === 'uncertain') actions[itemId] = { phase: 'uncertain' };
    else if (action?.phase === 'error') delete actions[itemId];
    const id = CSS.escape(itemId);
    next = `${action?.kind === 'abandon' ? `[data-abandon="${id}"],` : ''}[data-queue="${id}"],[data-start="${id}"],[data-start-result="${id}"],[data-add-item]`;
  } else dismissed.add(key);
  render();
  if (hadFocus && document.activeElement === document.body) {
    // querySelector returns the first in page order; take the first selector that matches.
    const target = next.split(',').map((sel) => app.querySelector<HTMLElement>(sel)).find(Boolean);
    target?.focus({ preventScroll: true });
  }
}

/** Toasts sit top right, below the header while it's on screen, so they never cover its buttons or banners. */
function placeToasts(): void {
  const bottom = app.querySelector('header.top')?.getBoundingClientRect().bottom ?? 0;
  document.documentElement.style.setProperty('--toast-top', `${Math.max(12, Math.round(bottom) + 8)}px`);
}

function startToastClocks(): void {
  placeToasts();
  app.querySelectorAll<HTMLElement>('[data-expires]').forEach((el) => {
    const key = el.dataset.expires!;
    if (expiring.has(key)) {
      el.classList.add('seen');
      return;
    }
    expiring.add(key);
    const expire = (paused = false) => {
      const toast = app.querySelector<HTMLElement>(`[data-expires="${CSS.escape(key)}"]`);
      if (!toast) expiring.delete(key); // gone for now: its clock starts again if it comes back
      else if (toast.matches(':hover, :focus-within')) setTimeout(() => expire(true), 1_000); // being read or used
      else if (paused) setTimeout(expire, TOAST_MS); // a full 5 s again once it's left
      else dismiss(key);
    };
    setTimeout(expire, TOAST_MS);
  });
}

function tagFocusable(): void {
  // Give tabs, toggles and buttons stable keys so focus survives a re-render.
  app.querySelectorAll<HTMLElement>('[data-view],[data-copy],[data-queue],[data-start],[data-start-result],[data-abandon],[data-add-item],[data-update],[data-dismiss],[data-view-item],details[id] > summary').forEach((el) => {
    el.dataset.focusKey = focusKeyOf(el);
  });
}

function focusKeyOf(el: HTMLElement): string {
  if (el.dataset.queue) return `queue-${el.dataset.queue}`;
  if (el.dataset.start) return `start-${el.dataset.start}`;
  if (el.dataset.startResult) return `result-${el.dataset.startResult}`;
  if (el.hasAttribute('data-update')) return 'update';
  if (el.dataset.dismiss) return `dismiss-${el.dataset.dismiss}`;
  if (el.dataset.viewItem) return `view-${el.dataset.viewItem}`;
  // Keyed by project item id, since a draft has no number.
  if (el.dataset.abandon) return `abandon-${el.dataset.abandon}`;
  return el.dataset.view ?? el.dataset.copy ?? (el.hasAttribute('data-add-item') ? 'add-item' : `summary-${el.parentElement?.id}`);
}

function focusByKey(key: string): void {
  app.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
}

function schedulePoll(): void {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void poll(), updating && updateView?.phase !== 'lost' ? UPDATE_POLL_MS : POLL_MS);
}

async function poll(): Promise<void> {
  const version = mutationVersion;
  const sequence = ++pollSequence;
  try {
    const res = await fetch('/api/board', { cache: 'no-store', signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (version !== mutationVersion || sequence !== pollSequence) return;
    // Polls each second during an update: redraw only on change, so the progress isn't announced again.
    const unchanged = updating !== null && clientError === null && text === lastBoard;
    lastBoard = text;
    data = JSON.parse(text) as BoardData;
    clientError = null;
    dismissed.delete('client-error');
    const view = updateView;
    if (followUpdate() || (unchanged && view === updateView)) return;
  } catch (err) {
    if (version !== mutationVersion || sequence !== pollSequence) return;
    if (updating) {
      // The board is expected to go away while the update restarts it.
      updating.awaySince ??= Date.now();
      if (Date.now() - updating.awaySince > RESTART_MS) updateView = { phase: 'lost' };
    } else clientError = err instanceof Error ? err.message : String(err);
  } finally {
    if (sequence === pollSequence) schedulePoll();
  }
  render();
}

/** Follows a running update from the latest data; true when the page reloads onto the restarted board. */
function followUpdate(): boolean {
  // Back, or an update someone else started is running: either way this page's failure no longer holds.
  if (updateView?.phase === 'lost' || (updateView?.phase === 'refused' && data.update?.state === 'running')) updateView = null;
  if (data.update?.state === 'running') {
    updating ??= { session: data.capture?.session, awaySince: null };
    updating.awaySince = null;
    return false;
  }
  // A new session means the board restarted: reload to run its new revision.
  const restarted = updating !== null && updating.session !== data.capture?.session;
  updating = null;
  if (restarted) location.reload();
  return restarted;
}

function setView(view: View, focus = false): void {
  ui.view = view;
  history.replaceState(null, '', view === 'flow' ? '#flow' : location.pathname);
  render();
  if (focus) app.querySelector<HTMLElement>(`[data-view="${view}"]`)?.focus();
}

/** Shows an item where it is after the latest poll: on the Board, with its List group open. Does nothing once it's gone. */
function viewItem(itemId: string): void {
  const item = data.items.find((i) => i.id === itemId);
  if (!item) return;
  if (ui.view !== 'board') setView('board');
  const group = listGroupId(platformOf(item, data.repos));
  if (item.status === 'List' && ui.toggled[group] === false) {
    ui.toggled[group] = true;
    render();
  }
  jumpTo(app.querySelector<HTMLElement>(`#panel-board [data-anchor="${CSS.escape(itemId)}"]`));
}

/** Deliberate navigation: bring an element into view, flash it and move focus into it. */
function jumpTo(el: HTMLElement | null): void {
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  el.classList.remove('anchor-flash');
  void el.offsetWidth; // restart the animation
  el.classList.add('anchor-flash');
  // The title first: on a Queued card Start comes earlier in the page, and Enter must not start a thread.
  el.querySelector<HTMLElement>('a.title, a.row-title, a.o-title, a, button')?.focus({ preventScroll: true });
}

async function copy(text: string, button: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Fallback for previews without clipboard permission.
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }
  button.textContent = 'Copied';
  setTimeout(() => {
    if (button.isConnected) button.textContent = 'Copy';
  }, 1500);
}

repoSelect.addEventListener('change', () => {
  form.querySelectorAll<HTMLElement>('[data-applicability]').forEach((group) => {
    const hidden = group.dataset.applicability !== repoSelect.value;
    group.hidden = hidden;
    group.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
      input.checked = false;
      input.disabled = hidden;
    });
  });
});
form.querySelector('[data-close-item]')?.addEventListener('click', () => dialog.close());

const fields = document.getElementById('item-fields') as HTMLFieldSetElement;
const submit = document.getElementById('item-submit') as HTMLButtonElement;
const resultBox = document.getElementById('item-result')!;
const newItem = document.getElementById('item-new') as HTMLButtonElement;
type Attempt = { requestId: string; session: string | undefined; draft: ItemDraft };
type Submission =
  | { phase: 'editing' | 'complete' }
  | { phase: 'pending' | 'retry' | 'uncertain'; attempt: Attempt };
let submission: Submission = { phase: 'editing' };
let revealList = false;

function message(text: string, url?: string | null, label = 'View created issue'): void {
  resultBox.replaceChildren(document.createTextNode(text));
  if (url) {
    const link = document.createElement('a');
    link.href = url;
    link.textContent = label;
    link.target = '_blank';
    link.rel = 'noopener';
    resultBox.append(link);
  }
}

function updateSubmission(): void {
  const { phase } = submission;
  fields.disabled = phase === 'pending' || phase === 'retry' || phase === 'uncertain';
  submit.disabled = phase === 'pending' || phase === 'uncertain' || data.capture?.enabled === false;
  submit.textContent = phase === 'pending' ? 'Adding…' : phase === 'retry' ? 'Retry this submission' : 'Add to List';
  form.setAttribute('aria-busy', String(phase === 'pending'));
  newItem.hidden = phase !== 'uncertain';
}

function resetDraft(): void {
  form.reset();
  repoSelect.dispatchEvent(new Event('change'));
  submission = { phase: 'editing' };
  message(data.capture?.enabled === false ? 'Adding items is disabled in sample mode.' : '');
  updateSubmission();
}

form.addEventListener('input', () => {
  if (submission.phase === 'editing') message('');
});
newItem.addEventListener('click', resetDraft);
dialog.addEventListener('close', () => {
  const target = revealList && notice
    ? document.querySelector<HTMLElement>(`#${CSS.escape(listGroupId(platformOf(notice.item, data.repos)))} > summary`)
    : app.querySelector<HTMLElement>('[data-add-item]');
  revealList = false;
  target?.focus();
  target?.scrollIntoView({ block: 'nearest' });
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (submission.phase === 'editing' || submission.phase === 'retry') void submitItem();
});

async function submitItem(): Promise<void> {
  const retrying = submission.phase === 'retry';
  let attempt: Attempt;
  if (submission.phase === 'retry') attempt = submission.attempt;
  else {
    const values = new FormData(form);
    try {
      const draft = validateDraft({ repo: values.get('repo'), kind: values.get('kind'),
        title: values.get('title'), description: values.get('description'), labels: values.getAll('labels') }, data.repos);
      attempt = { requestId: crypto.randomUUID(), session: data.capture?.session, draft };
    } catch (err) {
      message((err as Error).message);
      form.reportValidity();
      return;
    }
  }
  submission = { phase: 'pending', attempt };
  mutationVersion++;
  message(retrying ? 'Finishing this submission…' : 'Creating the issue and adding it to List…');
  updateSubmission();
  try {
    const response = await fetch('/api/items', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(attempt) });
    const result = await response.json() as CreationResult & { board?: BoardData };
    if (result.item && result.board) {
      mutationVersion++;
      data = result.board;
      setNotice({ verb: 'Added', item: result.item, to: 'List' });
      ui.toggled[listGroupId(platformOf(result.item, data.repos))] = true;
      submission = { phase: 'complete' };
      revealList = true;
      setView('board');
      dialog.close();
    } else {
      submission = result.uncertain ? { phase: 'uncertain', attempt }
        : result.issueUrl ? { phase: 'retry', attempt } : { phase: 'editing' };
      message(`${result.issueUrl ? 'Issue created. ' : ''}${result.error ?? `Request failed (HTTP ${response.status}).`}${result.issueUrl ? ' Retry to finish this issue.' : ''}`,
        result.issueUrl ?? (result.uncertain ? `https://github.com/${attempt.draft.repo}/issues` : null), result.issueUrl ? 'View created issue' : 'Check repository issues');
    }
  } catch {
    submission = { phase: 'retry', attempt };
    message('The submission response was lost. Retry this submission to recover its result without creating another issue.');
  } finally {
    updateSubmission();
  }
}

/** Posts an item action and returns the server's answer, or a message when the server can't be reached. */
async function postAction<T extends { error: string | null; board?: BoardData }>(path: string, body: object): Promise<T> {
  mutationVersion++;
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json() as T;
    if (result.board) {
      mutationVersion++;
      data = result.board;
    }
    return { ...result, error: result.error ?? (response.ok ? null : `Request failed (HTTP ${response.status}).`) };
  } catch {
    return { error: "Can't reach the board server. Try again." } as T;
  }
}

/** When this button's row leaves List, keep keyboard focus in the list: the same button on the next row, else its group. */
function focusAfterLeaving(button: HTMLElement, attr: string): string {
  const row = button.closest('li');
  const neighbour = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLElement>(`[${attr}]`);
  return neighbour ? focusKeyOf(neighbour) : `summary-${button.closest('details')?.id}`;
}

async function queueItem(button: HTMLElement): Promise<void> {
  const itemId = button.dataset.queue!;
  if (actions[itemId]?.phase === 'pending') return;
  const nextFocus = focusAfterLeaving(button, 'data-queue');
  actions[itemId] = { phase: 'pending' };
  render();
  const result = await postAction('/api/queue', { itemId });
  const item = data.items.find((i) => i.id === itemId);
  if (result.error || !item) actions[itemId] = { phase: 'error', message: result.error ?? 'The item left the board.' };
  else {
    delete actions[itemId];
    setNotice({ verb: 'Moved', item, to: 'Queued' });
  }
  render();
  if (!result.error && document.activeElement === document.body) focusByKey(nextFocus);
}

async function startUpdate(): Promise<void> {
  if (updateView?.phase === 'starting' || (data.update?.state === 'running' && updateView?.phase !== 'lost')) return;
  updateView = { phase: 'starting' };
  dismissed.delete('refused');
  dismissed.delete('lost');
  render();
  const session = data.capture?.session;
  const result = await postAction('/api/update', {});
  if (result.error) updateView = { phase: 'refused', message: result.error };
  else {
    updateView = null;
    updating = { session, awaySince: null };
  }
  render();
  schedulePoll();
}

async function startItem(itemId: string): Promise<void> {
  if (actions[itemId]?.phase === 'pending') return;
  actions[itemId] = { phase: 'pending' };
  render();
  const result = await postAction<StartResult & { error: string | null }>('/api/start', { session: data.capture?.session, itemId });
  actions[itemId] = result.thread ? { phase: 'started', thread: result.thread }
    : { phase: result.uncertain ? 'uncertain' : 'error', message: result.error ?? 'The thread did not start.' };
  const item = data.items.find((i) => i.id === itemId);
  if (result.thread && item) setNotice({ verb: 'Started', item, thread: result.thread });
  render();
  // The Start button is gone once a thread starts or may have started; move focus to what replaced it.
  if (document.activeElement === document.body) {
    app.querySelector<HTMLElement>(`[data-start-result="${CSS.escape(itemId)}"]`)?.focus({ preventScroll: true });
  }
}

const abandonDialog = document.getElementById('abandon-dialog') as HTMLDialogElement;
const abandonConfirm = abandonDialog.querySelector<HTMLButtonElement>('[data-abandon-confirm]')!;
let abandonTarget: string | null = null;

function askAbandon(itemId: string): void {
  const item = data.items.find((i) => i.id === itemId);
  if (!item || actions[itemId]?.phase === 'pending') return;
  const prompt = abandonPrompt(item);
  document.getElementById('abandon-heading')!.textContent = prompt.question;
  document.getElementById('abandon-detail')!.textContent = prompt.detail;
  abandonConfirm.textContent = prompt.confirm;
  abandonTarget = itemId;
  abandonDialog.returnValue = '';
  abandonDialog.showModal();
}

abandonDialog.querySelector('[data-abandon-cancel]')!.addEventListener('click', () => abandonDialog.close());
abandonConfirm.addEventListener('click', () => abandonDialog.close('confirm'));
// Escape closes it too, as a cancel. A poll may have redrawn the button, so focus it by key.
abandonDialog.addEventListener('close', () => {
  const itemId = abandonTarget;
  abandonTarget = null;
  if (!itemId) return;
  if (abandonDialog.returnValue === 'confirm') void abandonItem(itemId);
  else focusByKey(`abandon-${itemId}`);
});

async function abandonItem(itemId: string): Promise<void> {
  const button = app.querySelector<HTMLElement>(`[data-abandon="${CSS.escape(itemId)}"]`);
  const item = data.items.find((i) => i.id === itemId);
  if (!button || !item || actions[itemId]?.phase === 'pending') return;
  const nextFocus = focusAfterLeaving(button, 'data-abandon');
  actions[itemId] = { phase: 'pending', kind: 'abandon' };
  render();
  focusByKey(`abandon-${itemId}`);
  const result = await postAction('/api/abandon', { session: data.capture?.session, itemId });
  if (result.error) actions[itemId] = { phase: 'error', kind: 'abandon', message: result.error };
  else {
    delete actions[itemId];
    setNotice({ verb: 'Abandoned', item });
  }
  render();
  if (!result.error && document.activeElement === document.body) focusByKey(nextFocus);
}

app.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-view],[data-copy],[data-queue],[data-start],[data-abandon],[data-add-item],[data-update],[data-outline-jump],[data-dismiss],[data-view-item]');
  if (!target) return;
  if (target.dataset.outlineJump) {
    // An in-page link: keep it out of the hash, which picks the view.
    event.preventDefault();
    jumpTo(document.getElementById(`o-${target.dataset.outlineJump}`));
  } else if (target.dataset.dismiss) dismiss(target.dataset.dismiss);
  else if (target.dataset.viewItem) viewItem(target.dataset.viewItem);
  else if (target.hasAttribute('data-add-item')) {
    if (submission.phase === 'complete') resetDraft();
    dialog.showModal();
    form.querySelector<HTMLElement>('[name="repo"]')?.focus();
  } else if (target.dataset.view) setView(target.dataset.view as View);
  else if (target.dataset.copy) void copy(target.dataset.copy, target as HTMLButtonElement);
  else if (target.dataset.queue) void queueItem(target);
  else if (target.dataset.start) void startItem(target.dataset.start);
  else if (target.hasAttribute('data-update')) void startUpdate();
  else if (target.dataset.abandon) askAbandon(target.dataset.abandon);
});

// Arrow keys move between the Board and Flow tabs (WAI-ARIA tabs pattern).
app.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (!target.dataset.view || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  setView(ui.view === 'board' ? 'flow' : 'board', true);
});

// Remember which <details> are open so a re-render keeps them that way.
app.addEventListener(
  'toggle',
  (event) => {
    const el = event.target as HTMLDetailsElement;
    if (!el.id) return;
    ui.toggled[el.id] = el.open;
  },
  true,
);

window.addEventListener('hashchange', () => setView(location.hash === '#flow' ? 'flow' : 'board'));

addEventListener('scroll', placeToasts, { passive: true });
addEventListener('resize', placeToasts);
if (ui.view !== DEFAULT_UI.view) render();
else {
  tagFocusable();
  startToastClocks();
}
resetDraft();
followUpdate();
schedulePoll();
