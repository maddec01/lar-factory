// The item dialog's buttons that move an item: Queue on a List item, Back to List on a Queued one and Abandon on
// both, each with its pending label.

import { useId, useRef } from 'react';
import { canAbandon, itemName, ref } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Button } from '@lar-factory/ui/design-system/Button';
import { useActionStore, useItemAction } from './action-store.ts';
import type { ItemAction } from './action-store.ts';
import { askAbandon, backToList, queueItem } from './card-actions.ts';
import { DismissButton, closeKeepingFocus } from '../notices/toasts.tsx';
import { kind } from '../buttons/button-kinds.tsx';

/** Board writes are off in sample mode, so its buttons are too; an action in flight holds them. */
export function writeState(data: BoardData, action?: ItemAction): { disabled?: true; title?: string; 'aria-disabled'?: true } {
  if (data.capture?.enabled === false) return { disabled: true, title: 'Disabled in sample mode' };
  return action?.phase === 'pending' ? { 'aria-disabled': true } : {};
}

/** Queue, a List item's primary action. */
export function QueueButton({ item, data }: { item: Item; data: BoardData }) {
  const action = useItemAction(item.id);
  const verb = action?.phase === 'pending' && action.kind === 'queue' ? 'Queuing…' : 'Queue';
  return <Button {...kind('other')} data-queue={item.id} aria-label={`${verb} ${itemName(item)}`}
    {...writeState(data, action)} onClick={() => void queueItem(item.id)}>{verb}</Button>;
}

/** The muted link-style button in a Queued item's footer that moves it back to List. */
export function BackToListButton({ item, data }: { item: Item; data: BoardData }) {
  const action = useItemAction(item.id);
  const moving = action?.phase === 'pending' && action.kind === 'back-to-list';
  return <Button {...kind('other')} className="link-action" data-back-to-list={item.id} aria-label={`${moving ? 'Moving' : 'Back to List'} ${itemName(item)}`}
    {...writeState(data, action)} onClick={() => void backToList(item.id)}>{moving ? 'Moving to List…' : 'Back to List'}</Button>;
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
    <Button {...kind('other')} className="link-action disabled:pointer-events-auto" data-abandon={item.id} aria-label={`${verb} ${itemName(item)}`}
      {...state} onClick={() => askAbandon(item.id)}>{verb}</Button>
    {refusal && <span id={reason} className="text-base-700" data-abandon-refusal>{refusal}</span>}
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
