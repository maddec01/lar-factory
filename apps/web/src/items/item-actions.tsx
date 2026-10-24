// The buttons that move an item: Queue on a List row, Back to List on a Queued card, and Abandon
// on both, each also in the item dialog, each with its pending label, plus a List row's error.

import { useRef } from 'react';
import { canAbandon, ref } from '@mux-factory/shared';
import type { BoardData, Item } from '@mux-factory/shared';
import { Button, InlineButton } from '@mux-factory/ui/button';
import { useActionStore, useItemAction } from './action-store.ts';
import { askAbandon, backToList, queueItem } from './card-actions.ts';
import { writeState } from './card.tsx';
import { DismissButton, closeKeepingFocus } from '../notices/toasts.tsx';

/** Queue as a List row's button, or as the item dialog's `primary` action. */
export function QueueButton({ item, data, primary = false }: { item: Item; data: BoardData; primary?: boolean }) {
  const action = useItemAction(item.id);
  const verb = action?.phase === 'pending' && action.kind === 'queue' ? 'Queuing…' : 'Queue';
  return <Button variant={primary ? 'default' : 'outline'} size={primary ? 'sm' : 'xs'} className="row-action" data-queue={item.id} aria-label={`${verb} ${ref(item)} ${item.title}`}
    {...writeState(data, action)} onClick={() => void queueItem(item.id)}>{verb}</Button>;
}

/** The muted link-style button in a Queued card's footer row that moves it back to List. */
export function BackToListButton({ item, data }: { item: Item; data: BoardData }) {
  const action = useItemAction(item.id);
  const moving = action?.phase === 'pending' && action.kind === 'back-to-list';
  return <InlineButton tone="muted" className="link-action" data-back-to-list={item.id} aria-label={`${moving ? 'Moving' : 'Back to List'} ${ref(item)} ${item.title}`}
    {...writeState(data, action)} onClick={() => void backToList(item.id)}>{'←'} {moving ? 'Moving to List…' : 'Back to List'}</InlineButton>;
}

/** Abandon as a List row's button, or as a Queued card footer's link. */
export function AbandonButton({ item, data, inFooter = false }: { item: Item; data: BoardData; inFooter?: boolean }) {
  const action = useItemAction(item.id);
  if (!canAbandon(item)) return null;
  const verb = action?.phase === 'pending' && action.kind === 'abandon' ? 'Abandoning…' : 'Abandon';
  const props = { 'data-abandon': item.id, 'aria-label': `${verb} ${ref(item)} ${item.title}`, ...writeState(data, action), onClick: () => askAbandon(item.id) };
  return inFooter
    ? <InlineButton tone="destructive" className="link-action danger" {...props}>{verb}</InlineButton>
    : <Button variant="destructive-outline" size="xs" className="row-action" {...props}>{verb}</Button>;
}

/** A List row's failed Queue or Abandon, by its buttons until it's closed. */
export function ActionError({ item }: { item: Item }) {
  const action = useItemAction(item.id);
  const el = useRef<HTMLSpanElement>(null);
  if (action?.phase !== 'error' || !action.message) return null;
  const id = CSS.escape(item.id);
  const close = () => closeKeepingFocus(el.current, () => useActionStore.getState().set(item.id, undefined),
    [`[data-${action.kind === 'abandon' ? 'abandon' : 'queue'}="${id}"]`, `[data-queue="${id}"]`]);
  return <span className="action-error" ref={el}><span role="alert">{action.message}</span> <DismissButton what={` error for ${ref(item)}`} onClick={close} /></span>;
}
