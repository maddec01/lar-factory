// The item dialog's buttons that move an item: Queue on a List item, Back to List on a Queued one, Abandon on
// both, and Keep for each status of an issue that carries more than one, each with its pending label, plus a failed
// Queue's or Keep's error.

import { useId, useRef } from 'react';
import { canAbandon, ref } from '@lar-factory/shared';
import type { BoardData, Item, Status } from '@lar-factory/shared';
import { Button, InlineButton } from '@lar-factory/ui/button';
import { useActionStore, useItemAction } from './action-store.ts';
import type { ItemAction } from './action-store.ts';
import { askAbandon, backToList, pickStatus, queueItem } from './card-actions.ts';
import { DismissButton, closeKeepingFocus } from '../notices/toasts.tsx';

/** Board writes are off in sample mode, so its buttons are too; an action in flight holds them. */
export function writeState(data: BoardData, action?: ItemAction): { disabled?: true; title?: string; 'aria-disabled'?: true } {
  if (data.capture?.enabled === false) return { disabled: true, title: 'Disabled in sample mode' };
  return action?.phase === 'pending' ? { 'aria-disabled': true } : {};
}

/** Queue, a List item's primary action. */
export function QueueButton({ item, data }: { item: Item; data: BoardData }) {
  const action = useItemAction(item.id);
  const verb = action?.phase === 'pending' && action.kind === 'queue' ? 'Queuing…' : 'Queue';
  return <Button size="sm" data-queue={item.id} aria-label={`${verb} ${ref(item)} ${item.title}`}
    {...writeState(data, action)} onClick={() => void queueItem(item.id)}>{verb}</Button>;
}

/** The muted link-style button in a Queued item's footer that moves it back to List. */
export function BackToListButton({ item, data }: { item: Item; data: BoardData }) {
  const action = useItemAction(item.id);
  const moving = action?.phase === 'pending' && action.kind === 'back-to-list';
  return <InlineButton tone="muted" className="link-action" data-back-to-list={item.id} aria-label={`${moving ? 'Moving' : 'Back to List'} ${ref(item)} ${item.title}`}
    {...writeState(data, action)} onClick={() => void backToList(item.id)}>{'←'} {moving ? 'Moving to List…' : 'Back to List'}</InlineButton>;
}

/** Keep, one per status an item carrying more than one has: the only moves it offers until one is picked. */
export function PickStatusButtons({ item, data }: { item: Item; data: BoardData }) {
  const action = useItemAction(item.id);
  const keeping = (status: Status) => action?.phase === 'pending' && action.kind === 'pick-status' && action.status === status;
  return item.statuses.map((status) => (
    <Button key={status} size="sm" variant="outline" data-pick-status={status} aria-label={`${keeping(status) ? 'Keeping' : 'Keep'} ${status} on ${ref(item)} ${item.title}`}
      {...writeState(data, action)} onClick={() => void pickStatus(item.id, status)}>{keeping(status) ? 'Keeping…' : `Keep ${status}`}</Button>
  ));
}

/** Abandon, a link in the footer; greyed out, with a line saying why, on an item whose provider can't abandon it. */
export function AbandonButton({ item, data }: { item: Item; data: BoardData }) {
  const action = useItemAction(item.id);
  const reason = useId();
  if (!canAbandon(item)) return null;
  const verb = action?.phase === 'pending' && action.kind === 'abandon' ? 'Abandoning…' : 'Abandon';
  const refusal = item.abandonRefusal;
  const state = refusal ? { disabled: true as const, title: refusal, 'aria-describedby': reason } : writeState(data, action);
  return <>
    <InlineButton tone="destructive" className="link-action danger disabled:pointer-events-auto" data-abandon={item.id} aria-label={`${verb} ${ref(item)} ${item.title}`}
      {...state} onClick={() => askAbandon(item.id)}>{verb}</InlineButton>
    {refusal && <span id={reason} className="text-muted-foreground" data-abandon-refusal>{refusal}</span>}
  </>;
}

/** A failed Queue or Keep, until it's closed. */
export function ActionError({ item }: { item: Item }) {
  const action = useItemAction(item.id);
  const el = useRef<HTMLSpanElement>(null);
  if (action?.phase !== 'error' || !action.message) return null;
  const close = () => closeKeepingFocus(el.current, () => useActionStore.getState().set(item.id, undefined), [`[data-queue="${CSS.escape(item.id)}"]`]);
  return <span className="action-error" ref={el}><span role="alert">{action.message}</span> <DismissButton what={` error for ${ref(item)}`} onClick={close} /></span>;
}
