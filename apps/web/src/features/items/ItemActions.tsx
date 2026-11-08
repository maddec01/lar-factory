import type { BoardData, Item } from '@lar-factory/shared';
// The item dialog's buttons that move an item: Queue on a List item, Move to List on a Queued one and Abandon on
// both, each with its pending label.
import { canAbandon, itemName, ref } from '@lar-factory/shared';
import { Button, Text } from '@lar-works/design-system';
import { useId, useRef } from 'react';

import { writeState } from './ActionAvailability';
import { useActionStore, useItemAction } from './ActionStore';
import { askAbandon, backToList, queueItem } from './CardActions';
import { DismissButton, closeKeepingFocus } from '@/features/notices';
import { ActionError as DesignActionError, buttonKind } from '@/ui/board';

/** Queue, a List item's primary action. */
export function QueueButton({ item, data }: { item: Item; data: BoardData }) {
    const action = useItemAction(item.id);
    const verb = action?.phase === 'pending' && action.kind === 'queue' ? 'Queuing…' : 'Queue';

    return (
        <Button
            {...buttonKind('main')}
            data-queue={item.id}
            aria-label={`${verb} ${itemName(item)}`}
            {...writeState(data, action)}
            onClick={() => void queueItem(item.id)}
        >
            {verb}
        </Button>
    );
}

/** The muted link-style button in a Queued item's footer that moves it back to List. */
export function BackToListButton({ item, data }: { item: Item; data: BoardData }) {
    const action = useItemAction(item.id);
    const moving = action?.phase === 'pending' && action.kind === 'back-to-list';

    return (
        <Button
            {...buttonKind('other')}
            pendingLook
            data-back-to-list={item.id}
            aria-label={`${moving ? 'Moving' : 'Move to List'} ${itemName(item)}`}
            {...writeState(data, action)}
            onClick={() => void backToList(item.id)}
        >
            {moving ? 'Moving to List…' : 'Move to List'}
        </Button>
    );
}

/** Abandon, a link in the footer; greyed out, with a line saying why, on an item whose provider can't abandon it. */
export function AbandonButton({ item, data }: { item: Item; data: BoardData }) {
    const action = useItemAction(item.id);
    const reason = useId();

    if (!canAbandon(item)) return null;

    const verb = action?.phase === 'pending' && action.kind === 'abandon' ? 'Abandoning…' : 'Abandon';
    const refusal = item.abandonRefusal;
    const state = refusal
        ? { disabled: true as const, title: refusal, 'aria-describedby': reason }
        : writeState(data, action);

    return (
        <>
            <Button
                variant="destructive-quiet"
                size="sm"
                data-kind="other"
                pendingLook
                data-abandon={item.id}
                aria-label={`${verb} ${itemName(item)}`}
                {...state}
                onClick={() => askAbandon(item.id)}
            >
                {verb}
            </Button>
            {refusal && (
                <Text as="span" variant="caption" tone="muted" id={reason} data-abandon-refusal>
                    {refusal}
                </Text>
            )}
        </>
    );
}

/** A failed Queue or Keep, until it's closed. */
export function ActionError({ item }: { item: Item }) {
    const action = useItemAction(item.id);
    const el = useRef<HTMLSpanElement>(null);

    if (action?.phase !== 'error' || !action.message) return null;

    const close = () =>
        closeKeepingFocus(el.current, () => useActionStore.getState().set(item.id, undefined), [
            `[data-queue="${CSS.escape(item.id)}"]`,
        ]);

    return (
        <DesignActionError ref={el}>
            <span role="alert">{action.message}</span>{' '}
            <DismissButton inline what={` error for ${ref(item)}`} onClick={close} />
        </DesignActionError>
    );
}
