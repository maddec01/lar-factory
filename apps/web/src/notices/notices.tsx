// What this page just did to an item, announced in a toast: added, moved or kept with View item,
// abandoned, started in T3, or a Queued card's action that failed.

import { ref, workTitle, abandonPrompt } from '@lar-factory/shared';
import type { Item, StartedThread, Status } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/button';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { TitleLink } from '../items/item-parts.tsx';
import { clearToast, showToast } from './toasts.tsx';
import type { Toast } from './toasts.tsx';

export type Notice =
  | { verb: 'Added' | 'Moved'; item: Item; to: Status }
  /** Keep left the item carrying `status` alone. */
  | { verb: 'Kept'; item: Item; status: Status }
  | { verb: 'Abandoned'; item: Item }
  /** A Queued card's Back to List (`to`) or Abandon (no `to`) failed. */
  | { verb: 'Failed'; item: Item; to?: Status; message: string }
  | { verb: 'Started'; item: Item; thread: StartedThread };

/** Notices share one toast: a new one replaces the last. */
const SLOT = 'notice';

/** Opens the item, as it is in the latest data, in the item dialog. Does nothing once it's gone. */
function viewItem(itemId: string): void {
  if (!useBoardStore.getState().data.items.some((i) => i.id === itemId)) return;
  // Its toast has done its job.
  clearToast(SLOT);
  useItemDialogStore.getState().open(itemId);
}

const viewButton = (item: Item) => <Button variant="outline" size="xs" className="view-item" onClick={() => viewItem(item.id)}>View item</Button>;

function toastOf(notice: Notice): Toast {
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
    case 'Kept':
      return {
        slot: SLOT, what: `Kept ${notice.status} on ${ref(item)}`,
        body: <>Kept {notice.status} on <TitleLink item={item} />. {viewButton(item)}</>,
      };
    default:
      return {
        slot: SLOT, what: `${notice.verb} ${ref(item)}`,
        body: <>{notice.verb} <TitleLink item={item} /> to {notice.to}. {viewButton(item)}</>,
      };
  }
}

export function notify(notice: Notice): void {
  showToast(toastOf(notice));
}
