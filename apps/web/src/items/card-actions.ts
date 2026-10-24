// Queue, Back to List and Abandon: each posts to the board server, shows the result, and keeps
// keyboard focus on the page when the item leaves its list.

import { flushSync } from 'react-dom';
import { writeHeaders } from '@mux-factory/shared';
import type { BoardData } from '@mux-factory/shared';
import { useAbandonStore } from './abandon-store.ts';
import { useActionStore } from './action-store.ts';
import type { ItemAction } from './action-store.ts';
import { useBoardStore } from '../board/board-store.ts';
import { holdAnchor } from '../board/keep-anchor.ts';
import { notify } from '../notices/notices.tsx';
import { refocus } from '../notices/toasts.tsx';

export interface ActionResult {
  error: string | null;
  board?: BoardData;
}

/** Posts an item action and returns the server's answer, or a message when the server can't be reached. */
export async function postAction<T extends object = object>(path: string, body: object): Promise<ActionResult & Partial<T>> {
  useBoardStore.getState().beginWrite();
  try {
    const response = await fetch(path, { method: 'POST', headers: writeHeaders(), body: JSON.stringify(body) });
    const result = await response.json() as Partial<ActionResult & T>;
    return { ...result, error: result.error ?? (response.ok ? null : `Request failed (HTTP ${response.status}).`) };
  } catch {
    return { error: "Can't reach the board server. Try again." } as ActionResult & Partial<T>;
  }
}

/** Shows the board the server sent back with the action. Call inside the flushSync that shows the result. */
export function receive(result: ActionResult): void {
  if (!result.board) return;
  const board = useBoardStore.getState();
  board.beginWrite();
  holdAnchor();
  board.receive(result.board);
}

const by = (attr: string, value: string) => `[${attr}="${CSS.escape(value)}"]`;
const buttonOf = (attr: string, itemId: string) => document.querySelector<HTMLElement>(`#panel-board ${by(attr, itemId)}`);

/** When a List row leaves, keep keyboard focus in the list: the same button on the next row, else its group. */
function focusAfterRowLeaving(button: HTMLElement, attr: string): string[] {
  const row = button.closest('li');
  const neighbour = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector(`[${attr}]`);
  return [neighbour ? by(attr, neighbour.getAttribute(attr)!) : `#${CSS.escape(button.closest('[data-slot="collapsible"]')?.id ?? '')} > [data-slot="collapsible-trigger"]`];
}

const CARD_ACTIONS = ['data-start', 'data-back-to-list', 'data-abandon'];

/** When a Queued card leaves, keep keyboard focus in the section: the nearest card's first action (later cards first), else its heading. */
function focusAfterCardLeaving(button: HTMLElement): string[] {
  const card = button.closest('article');
  for (const step of ['nextElementSibling', 'previousElementSibling'] as const) {
    for (let sibling = card?.[step]; sibling; sibling = sibling[step]) {
      const action = sibling.querySelector(CARD_ACTIONS.map((a) => `[${a}]`).join(','));
      const attr = action && CARD_ACTIONS.find((a) => action.hasAttribute(a));
      if (attr) return [by(attr, action.getAttribute(attr)!)];
    }
  }
  return [`#${CSS.escape(button.closest('section')?.id ?? '')}-h`];
}

const pending = (itemId: string) => useActionStore.getState().actions[itemId]?.phase === 'pending';
const itemOf = (itemId: string) => useBoardStore.getState().data.items.find((i) => i.id === itemId);

/** The item's `attr` button, when it's on the page and the item has no action in flight. */
function readyButton(itemId: string, attr: string): HTMLElement | null {
  const button = buttonOf(attr, itemId);
  return button && !pending(itemId) ? button : null;
}

/**
 * Marks the item pending, posts `body` to `/api/<kind>`, then in one render shows the board the server sent and runs
 * `show`, which returns the error to keep on the item, if any.
 */
async function runAction(itemId: string, kind: ItemAction['kind'], body: object, show: (result: ActionResult) => string | undefined): Promise<ActionResult> {
  const actions = useActionStore.getState();
  actions.set(itemId, { phase: 'pending', kind });
  const result = await postAction(`/api/${kind}`, body);
  flushSync(() => {
    receive(result);
    const message = show(result);
    actions.set(itemId, message === undefined ? undefined : { phase: 'error', kind, message });
  });
  return result;
}

export async function queueItem(itemId: string): Promise<void> {
  const button = readyButton(itemId, 'data-queue');
  if (!button) return;
  const next = focusAfterRowLeaving(button, 'data-queue');
  const result = await runAction(itemId, 'queue', { itemId }, (result) => {
    const item = itemOf(itemId);
    if (result.error || !item) return result.error ?? 'The item left the board.';
    notify({ verb: 'Moved', item, to: 'Queued' });
  });
  if (!result.error) refocus(next);
}

export async function backToList(itemId: string): Promise<void> {
  const button = readyButton(itemId, 'data-back-to-list');
  const item = itemOf(itemId);
  if (!button || !item) return;
  const next = focusAfterCardLeaving(button);
  // A failure is a toast only: the card's footer goes back to its links.
  const result = await runAction(itemId, 'back-to-list', { itemId }, (result) => {
    notify(result.error ? { verb: 'Failed', item, to: 'List', message: result.error } : { verb: 'Moved', item, to: 'List' });
  });
  refocus(result.error ? [by('data-back-to-list', itemId)] : next);
}

/** Opens Abandon's confirm dialog for the item. */
export function askAbandon(itemId: string): void {
  const item = itemOf(itemId);
  if (item && !pending(itemId)) useAbandonStore.getState().ask(item);
}

export async function abandonItem(itemId: string): Promise<void> {
  const button = readyButton(itemId, 'data-abandon');
  const item = itemOf(itemId);
  if (!button || !item) return;
  const onCard = Boolean(button.closest('article'));
  const next = onCard ? focusAfterCardLeaving(button) : focusAfterRowLeaving(button, 'data-abandon');
  const result = await runAction(itemId, 'abandon', { session: useBoardStore.getState().data.capture?.session, itemId }, (result) => {
    // A List row keeps its error inline; a Queued card's is a toast only, and its footer goes back to its links.
    if (result.error && !onCard) return result.error;
    notify(result.error ? { verb: 'Failed', item, message: result.error } : { verb: 'Abandoned', item });
  });
  // A List row's error sits by its button, which stays; a card's failure goes back to its Abandon.
  if (!result.error) refocus(next);
  else if (onCard) refocus([by('data-abandon', itemId)]);
}
