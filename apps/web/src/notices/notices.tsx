// What this page just did to an item, announced in a toast: added or moved with View item,
// abandoned, started in T3, or a Queued card's action that failed.

import { platformOf, ref, workTitle, abandonPrompt, listGroupId } from '@mux-factory/shared';
import type { Item, StartedThread, Status } from '@mux-factory/shared';
import { Button } from '@mux-factory/ui/button';
import { useBoardStore } from '../board/board-store.ts';
import { useDetailsStore } from '../board/details-store.ts';
import { useJumpStore } from '../board/jump-store.ts';
import { TitleLink } from '../items/item-parts.tsx';
import { useToastStore } from './toast-store.ts';
import type { Toast } from './toast-store.ts';

export type Notice =
  | { verb: 'Added' | 'Moved'; item: Item; to: Status }
  | { verb: 'Abandoned'; item: Item }
  /** A Queued card's Back to List (`to`) or Abandon (no `to`) failed. */
  | { verb: 'Failed'; item: Item; to?: Status; message: string }
  | { verb: 'Started'; item: Item; thread: StartedThread };

/** Notices share one toast: a new one replaces the last. */
const SLOT = 'notice';

/** Shows an item where it is in the latest data: on the Board, with its List group open. Does nothing once it's gone. */
function viewItem(itemId: string): void {
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
    case 'Started': {
      const { title, threadId } = notice.thread;
      return {
        slot: SLOT, what: `started ${ref(item)}`,
        // T3 titles a thread after line 1 of the work message; don't repeat the issue.
        body: <>Started T3 thread{title !== workTitle(item) && <> <b>{title}</b></>} <code className="thread-id">{threadId}</code> for <TitleLink item={item} />.</>,
      };
    }
    default:
      return {
        slot: SLOT, what: `${notice.verb} ${ref(item)}`,
        body: <>{notice.verb} <TitleLink item={item} /> to {notice.to}. <Button variant="outline" size="xs" className="view-item" onClick={() => viewItem(item.id)}>View item</Button></>,
      };
  }
}

export function notify(notice: Notice): void {
  useToastStore.getState().show(toastOf(notice));
}
