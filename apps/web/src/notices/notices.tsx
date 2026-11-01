import { useContext, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useActionStore, useItemAction } from '../items/action-store.ts';
import { postAction, receive } from '../items/card-actions.ts';
import { ToastFailure, ToastLifetime } from './toasts.tsx';
// What this page just did to an item, announced in a toast: added, moved or kept with View item,
// abandoned or its ticket closed, started in T3, or a Queued card's action that failed.

import { ref, threadLink, abandonPrompt, closeTicketPrompt } from '@lar-factory/shared';
import type { Item, StartedThread, Status } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useBoardStore } from '../board/board-store.ts';
import { useItemDialogStore } from '../item-dialog/item-dialog-store.ts';
import { TitleLink } from '../items/item-parts.tsx';
import { clearToast, showToast } from './toasts.tsx';
import type { Toast } from './toasts.tsx';
import { LinkButton } from '../items/link-button.tsx';
import type { StartKind } from '../items/start-store.ts';
import { kind } from '../buttons/button-kinds.tsx';

export type Notice =
  | { verb: 'Added' | 'Moved'; item: Item; to: Status }
  /** Keep left the item carrying `status` alone. */
  | { verb: 'Abandoned'; item: Item }
  /** The ticket of work Abandon set aside closed. */
  | { verb: 'Closed'; item: Item }
  /** A Queued card's Back to List (`to`), Abandon, or the ticket close after it (`ticket`) failed. */
  | { verb: 'Failed'; item: Item; to?: Status; ticket?: true; message: string }
  | { verb: 'Started'; item: Item; thread: StartedThread; kind: StartKind };

/** Notices share one toast: a new one replaces the last. */
const SLOT = 'notice';

/** Opens the item, as it is in the latest data, in the item dialog. Does nothing once it's gone. */
function viewItem(itemId: string): void {
  if (!useBoardStore.getState().data.items.some((i) => i.id === itemId)) return;
  // Its toast has done its job.
  clearToast(SLOT);
  useItemDialogStore.getState().open(itemId);
}

const viewButton = (item: Item) => <Button {...kind('other')} className="view-item" onClick={() => viewItem(item.id)}>View item</Button>;

function toastOf(notice: Notice): Toast {
  const { item } = notice;
  switch (notice.verb) {
    // The issue is gone, so there is nothing to link to.
    case 'Abandoned':
      return { slot: SLOT, what: `Abandoned ${ref(item)}`, body: abandonPrompt(item).done };
    case 'Closed':
      return { slot: SLOT, what: `Closed the ticket of ${ref(item)}`, body: closeTicketPrompt(item).done };
    case 'Failed':
      return {
        slot: SLOT, failed: true, what: `error for ${ref(item)}`,
        body: <>Couldn't {notice.to ? <>move <TitleLink item={item} /> to {notice.to}</> : notice.ticket ? <>close the ticket of <TitleLink item={item} /></>
          : <>abandon <TitleLink item={item} /></>}. {notice.message}</>,
        // Back to the button that failed.
        focusAfter: [`[data-${notice.to ? 'back-to-list' : 'abandon'}="${CSS.escape(item.id)}"]`],
      };
    case 'Started': {
      const environment = useBoardStore.getState().data.t3EnvironmentId;
      return {
        slot: SLOT, what: `started ${ref(item)}`,
        body: <>{notice.kind === 'build' ? 'Build' : 'Refining'} started for {ref(item)}. {environment && <LinkButton kind="open" href={threadLink(environment, notice.thread.threadId)}>Open thread</LinkButton>}</>,
      };
    }
    default:
      if (notice.verb === 'Added' && notice.to === 'List') return { slot: SLOT, what: `Added ${ref(item)}`, body: <AddedNotice item={item} /> };
      return {
        slot: SLOT, what: `${notice.verb} ${ref(item)}`,
        body: <>{notice.verb} <TitleLink item={item} /> to {notice.to}. {viewButton(item)}</>,
      };
  }
}

export function notify(notice: Notice): void {
  showToast(toastOf(notice));
}

/** A mounted notice owns its feedback; late results only update the board after it leaves. */
function AddedNotice({ item }: { item: Item }) {
  const current = useBoardStore((state) => state.data.items.find((value) => value.id === item.id));
  const action = useItemAction(item.id);
  const hold = useContext(ToastLifetime);
  const fail = useContext(ToastFailure);
  const [result, setResult] = useState<'added' | 'pending' | 'success' | string>('added');
  const mounted = useRef(true);
  const queue = useRef<HTMLButtonElement>(null);
  const view = useRef<HTMLSpanElement>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { hold(result !== 'added' && result !== 'success'); }, [hold, result]);
  const failed = !['added', 'pending', 'success'].includes(result);
  useEffect(() => { fail(failed); }, [fail, failed]);
  const eligible = current?.status === 'List';
  const pending = action?.phase === 'pending';
  const activate = async () => {
    const latest = useBoardStore.getState().data.items.find((value) => value.id === item.id);
    if (latest?.status !== 'List' || useActionStore.getState().actions[item.id]?.phase === 'pending') return;
    useActionStore.getState().set(item.id, { phase: 'pending', kind: 'queue' });
    setResult('pending');
    const answer = await postAction('/api/queue', { itemId: item.id });
    const focused = document.activeElement === queue.current;
    flushSync(() => {
      receive(answer);
      useActionStore.getState().set(item.id, answer.error ? { phase: 'error', kind: 'queue', message: answer.error } : undefined);
      if (mounted.current) setResult(answer.error ?? 'success');
    });
    if (mounted.current && focused && !answer.error) view.current?.querySelector('button')?.focus();
  };
  return <><span role={failed ? 'alert' : 'status'}>{result === 'added' ? <>Added <TitleLink item={item} /> to List.</>
    : result === 'pending' ? 'Queueing…' : result === 'success' ? <>Moved <TitleLink item={item} /> to Queued.</> : result}</span>{' '}
    <span ref={view}>{viewButton(item)}</span>{' '}
    {eligible && result !== 'success' && <Button ref={queue} {...kind('other')} aria-disabled={pending} onClick={() => void activate()}>{pending ? 'Queueing…' : 'Queue'}</Button>}
  </>;
}
