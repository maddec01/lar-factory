// What this page just did to an item, announced in a toast: added or moved with View item,
// abandoned, or a Queued card's action that failed.

import { platformOf, ref } from '../model.ts';
import type { Item, Status } from '../model.ts';
import { abandonPrompt, listGroupId } from '../board-view.ts';
import { useBoardStore } from './board-store.ts';
import { useDetailsStore } from './details-store.ts';
import { useJumpStore } from './jump-store.ts';
import { TitleLink } from './item-parts.tsx';
import { useToastStore } from './toast-store.ts';
import type { Toast } from './toast-store.ts';

export type Notice =
  | { verb: 'Added' | 'Moved'; item: Item; to: Status }
  | { verb: 'Abandoned'; item: Item }
  /** A Queued card's Back to List (`to`) or Abandon (no `to`) failed. */
  | { verb: 'Failed'; item: Item; to?: Status; message: string };

/** Notices share one toast: a new one replaces the last. */
const SLOT = 'notice';

/** Shows an item where it is in the latest data: on the Board, with its List group open. Does nothing once it's gone. */
export function viewItem(itemId: string): void {
  const { data } = useBoardStore.getState();
  const item = data.items.find((i) => i.id === itemId);
  if (!item) return;
  // Its toast has done its job.
  useToastStore.getState().clear(SLOT);
  if (item.status === 'List') useDetailsStore.getState().setOpen(listGroupId(platformOf(item, data.repos)), true);
  useJumpStore.getState().request(itemId);
}

function toastOf(notice: Notice): Omit<Toast, 'key'> {
  const { item } = notice;
  switch (notice.verb) {
    // The issue is gone, so there is nothing to link to.
    case 'Abandoned':
      return { slot: SLOT, what: `Abandoned ${ref(item)}`, body: abandonPrompt(item).done };
    case 'Failed':
      return {
        slot: SLOT, failed: true, what: `error for ${ref(item)}`,
        body: <>Couldn't {notice.to ? <>move <TitleLink item={item} /> to {notice.to}</> : <>abandon <TitleLink item={item} /></>}. {notice.message}</>,
        // Back to the button that failed.
        focusAfter: [`[data-${notice.to ? 'back-to-list' : 'abandon'}="${CSS.escape(item.id)}"]`],
      };
    default:
      return {
        slot: SLOT, what: `${notice.verb} ${ref(item)}`,
        body: <>{notice.verb} <TitleLink item={item} /> to {notice.to}. <button type="button" className="copy view-item" onClick={() => viewItem(item.id)}>View item</button></>,
      };
  }
}

export function notify(notice: Notice): void {
  useToastStore.getState().show(toastOf(notice));
}
