// Queue, Back to List and Abandon from the item dialog: each posts to the board server, shows the result, and keeps
// keyboard focus in the dialog.

import { flushSync } from 'react-dom';
import { writeHeaders } from '@mux-factory/shared';
import type { BoardData } from '@mux-factory/shared';
import { useAbandonStore } from './abandon-store.ts';
import { useActionStore } from './action-store.ts';
import type { ItemAction } from './action-store.ts';
import { useBoardStore } from '../board/board-store.ts';
import { OPEN_ITEM_DIALOG } from '../item-dialog/item-dialog-store.ts';
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
  board.receive(result.board);
}

const by = (attr: string, value: string) => `[${attr}="${CSS.escape(value)}"]`;

const pending = (itemId: string) => useActionStore.getState().actions[itemId]?.phase === 'pending';
const itemOf = (itemId: string) => useBoardStore.getState().data.items.find((i) => i.id === itemId);

/** Whether the item's `attr` button is in the open item dialog and the item has no action in flight. */
const ready = (itemId: string, attr: string) => Boolean(document.querySelector(`${OPEN_ITEM_DIALOG} ${by(attr, itemId)}`)) && !pending(itemId);

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
  if (!ready(itemId, 'data-queue')) return;
  const result = await runAction(itemId, 'queue', { itemId }, (result) => {
    const item = itemOf(itemId);
    if (result.error || !item) return result.error ?? 'The item left the board.';
    notify({ verb: 'Moved', item, to: 'Queued' });
  });
  // The item stays on show, Queued, so focus goes to its Start.
  if (!result.error) refocus([by('data-start', itemId), by('data-back-to-list', itemId)]);
}

export async function backToList(itemId: string): Promise<void> {
  const item = itemOf(itemId);
  if (!ready(itemId, 'data-back-to-list') || !item) return;
  // A failure is a toast only: the dialog's footer goes back to its links.
  const result = await runAction(itemId, 'back-to-list', { itemId }, (result) => {
    notify(result.error ? { verb: 'Failed', item, to: 'List', message: result.error } : { verb: 'Moved', item, to: 'List' });
  });
  refocus([by(result.error ? 'data-back-to-list' : 'data-queue', itemId)]);
}

/** Opens Abandon's confirm dialog for the item. */
export function askAbandon(itemId: string): void {
  const item = itemOf(itemId);
  if (item && !pending(itemId)) useAbandonStore.getState().ask(item);
}

export async function abandonItem(itemId: string): Promise<void> {
  const item = itemOf(itemId);
  if (!ready(itemId, 'data-abandon') || !item) return;
  // A failure is a toast only, and the dialog's footer goes back to its links.
  const result = await runAction(itemId, 'abandon', { session: useBoardStore.getState().data.capture?.session, itemId }, (result) => {
    notify(result.error ? { verb: 'Failed', item, message: result.error } : { verb: 'Abandoned', item });
  });
  // An abandoned item leaves the item dialog, which closes and hands focus back itself.
  if (result.error) refocus([by('data-abandon', itemId)]);
}
