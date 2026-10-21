// Browser side: keeps the page live by fetching /api/board every 15 s and
// re-rendering with the same template the server used.

import { DEFAULT_UI, listGroupId, renderApp } from './render.ts';
import type { FlowTab, ItemAction, RenderOptions, UiState, View } from './render.ts';
import { platformOf } from './model.ts';
import type { BoardData } from './model.ts';
import { validateDraft } from './add-item.ts';
import type { CreationResult, ItemDraft } from './add-item.ts';

const POLL_MS = 15_000;
const app = document.getElementById('app')!;
const bootstrap = document.getElementById('board-data');
const dialog = document.getElementById('add-item-dialog') as HTMLDialogElement;
const form = document.getElementById('add-item-form') as HTMLFormElement;
const repoSelect = form.elements.namedItem('repo') as HTMLSelectElement;

let data: BoardData = JSON.parse(bootstrap?.textContent ?? 'null');
let clientError: string | null = null;
let notice: RenderOptions['notice'] = null;
const actions: Record<string, ItemAction> = {};
let mutationVersion = 0;
let pollSequence = 0;
const ui: UiState = {
  ...DEFAULT_UI,
  view: location.hash === '#flow' ? 'flow' : 'board',
  open: [],
};

function render(): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;
  const { scrollX, scrollY } = window;
  app.innerHTML = renderApp(data, { now: Date.now(), ui, clientError, notice, actions });
  tagFocusable();
  window.scrollTo(scrollX, scrollY);
  if (focusKey) focusByKey(focusKey);
}

function tagFocusable(): void {
  // Give tabs, toggles and buttons stable keys so focus survives a re-render.
  app.querySelectorAll<HTMLElement>('[data-view],[data-flow-tab],[data-copy],[data-queue],[data-add-item],details[id] > summary').forEach((el) => {
    el.dataset.focusKey = focusKeyOf(el);
  });
}

function focusKeyOf(el: HTMLElement): string {
  if (el.dataset.queue) return `queue-${el.dataset.queue}`;
  return el.dataset.view ?? el.dataset.flowTab ?? el.dataset.copy ?? (el.hasAttribute('data-add-item') ? 'add-item' : `summary-${el.parentElement?.id}`);
}

function focusByKey(key: string): void {
  app.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(key)}"]`)?.focus();
}

async function poll(): Promise<void> {
  const version = mutationVersion;
  const sequence = ++pollSequence;
  try {
    const res = await fetch('/api/board', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const next = (await res.json()) as BoardData;
    if (version !== mutationVersion || sequence !== pollSequence) return;
    data = next;
    clientError = null;
  } catch (err) {
    if (version !== mutationVersion || sequence !== pollSequence) return;
    clientError = err instanceof Error ? err.message : String(err);
  }
  render();
}

function setView(view: View, focus = false): void {
  ui.view = view;
  history.replaceState(null, '', view === 'flow' ? '#flow' : location.pathname);
  render();
  if (focus) app.querySelector<HTMLElement>(`[data-view="${view}"]`)?.focus();
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
      notice = { verb: 'Added', item: result.item, to: 'List' };
      ui.open = [...new Set([...ui.open, listGroupId(platformOf(result.item, data.repos))])];
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

async function queueItem(button: HTMLElement): Promise<void> {
  const itemId = button.dataset.queue!;
  if (actions[itemId]?.phase === 'pending') return;
  // When this row leaves List, keep keyboard focus in the list: the next row, else its group.
  const row = button.closest('li');
  const neighbour = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLElement>('[data-queue]');
  const nextFocus = neighbour ? focusKeyOf(neighbour) : `summary-${button.closest('details')?.id}`;
  actions[itemId] = { phase: 'pending' };
  render();
  const result = await postAction('/api/queue', { itemId });
  const item = data.items.find((i) => i.id === itemId);
  if (result.error || !item) actions[itemId] = { phase: 'error', message: result.error ?? 'The item left the board.' };
  else {
    delete actions[itemId];
    notice = { verb: 'Moved', item, to: 'Queued' };
  }
  render();
  if (!result.error && document.activeElement === document.body) focusByKey(nextFocus);
}

app.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-view],[data-flow-tab],[data-copy],[data-queue],[data-add-item]');
  if (!target) return;
  if (target.hasAttribute('data-add-item')) {
    if (submission.phase === 'complete') resetDraft();
    dialog.showModal();
    form.querySelector<HTMLElement>('[name="repo"]')?.focus();
  } else if (target.dataset.view) setView(target.dataset.view as View);
  else if (target.dataset.flowTab) {
    ui.flowTab = target.dataset.flowTab as FlowTab;
    render();
  } else if (target.dataset.copy) void copy(target.dataset.copy, target as HTMLButtonElement);
  else if (target.dataset.queue) void queueItem(target);
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
    ui.open = ui.open.filter((id) => id !== el.id);
    if (el.open) ui.open.push(el.id);
  },
  true,
);

window.addEventListener('hashchange', () => setView(location.hash === '#flow' ? 'flow' : 'board'));

if (ui.view !== DEFAULT_UI.view) render();
else tagFocusable();
resetDraft();
setInterval(() => void poll(), POLL_MS);
