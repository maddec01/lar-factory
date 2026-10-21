// Browser side: keeps the page live by fetching /api/board every 15 s and
// re-rendering with the same template the server used.

import { DEFAULT_UI, renderApp } from './render.ts';
import type { FlowTab, UiState, View } from './render.ts';
import type { BoardData } from './model.ts';

const POLL_MS = 15_000;
const app = document.getElementById('app')!;
const bootstrap = document.getElementById('board-data');

let data: BoardData = JSON.parse(bootstrap?.textContent ?? 'null');
let clientError: string | null = null;
const ui: UiState = {
  ...DEFAULT_UI,
  view: location.hash === '#flow' ? 'flow' : 'board',
  open: [],
};

function render(): void {
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;
  const { scrollX, scrollY } = window;
  app.innerHTML = renderApp(data, { now: Date.now(), ui, clientError });
  tagFocusable();
  window.scrollTo(scrollX, scrollY);
  if (focusKey) app.querySelector<HTMLElement>(`[data-focus-key="${CSS.escape(focusKey)}"]`)?.focus();
}

function tagFocusable(): void {
  // Give tabs, toggles and copy buttons stable keys so focus survives a re-render.
  app.querySelectorAll<HTMLElement>('[data-view],[data-flow-tab],[data-copy],details[id] > summary').forEach((el) => {
    el.dataset.focusKey =
      el.dataset.view ?? el.dataset.flowTab ?? el.dataset.copy ?? `summary-${el.parentElement?.id}`;
  });
}

async function poll(): Promise<void> {
  try {
    const res = await fetch('/api/board', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = (await res.json()) as BoardData;
    clientError = null;
  } catch (err) {
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

app.addEventListener('click', (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[data-view],[data-flow-tab],[data-copy]');
  if (!target) return;
  if (target.dataset.view) setView(target.dataset.view as View);
  else if (target.dataset.flowTab) {
    ui.flowTab = target.dataset.flowTab as FlowTab;
    render();
  } else if (target.dataset.copy) void copy(target.dataset.copy, target as HTMLButtonElement);
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
setInterval(() => void poll(), POLL_MS);
