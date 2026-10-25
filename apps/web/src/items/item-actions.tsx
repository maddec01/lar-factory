// The item dialog's buttons that move an item: Queue on a List item, Back to List on a Queued one, and Abandon on
// both, each with its pending label, plus a failed Queue's error.

import { useRef } from 'react';
import { canAbandon, ref } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Button, InlineButton } from '@lar-factory/ui/button';
import { useActionStore, useItemAction } from './action-store.ts';
import type { ItemAction } from './action-store.ts';
import { askAbandon, backToList, queueItem } from './card-actions.ts';
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

/** Abandon, a link in the footer. */
export function AbandonButton({ item, data }: { item: Item; data: BoardData }) {
  const action = useItemAction(item.id);
  if (!canAbandon(item)) return null;
  const verb = action?.phase === 'pending' && action.kind === 'abandon' ? 'Abandoning…' : 'Abandon';
  return <InlineButton tone="destructive" className="link-action danger" data-abandon={item.id} aria-label={`${verb} ${ref(item)} ${item.title}`}
    {...writeState(data, action)} onClick={() => askAbandon(item.id)}>{verb}</InlineButton>;
}

/** A failed Queue, until it's closed. */
export function ActionError({ item }: { item: Item }) {
  const action = useItemAction(item.id);
  const el = useRef<HTMLSpanElement>(null);
  if (action?.phase !== 'error' || !action.message) return null;
  const close = () => closeKeepingFocus(el.current, () => useActionStore.getState().set(item.id, undefined), [`[data-queue="${CSS.escape(item.id)}"]`]);
  return <span className="action-error" ref={el}><span role="alert">{action.message}</span> <DismissButton what={` error for ${ref(item)}`} onClick={close} /></span>;
}
