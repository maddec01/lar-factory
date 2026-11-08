// An added item's toast, with View item and Queue while the item is on List. A mounted notice owns its feedback;
// late results still update the board after it leaves.

import type { Item } from '@lar-factory/shared';
import { Button, useNotificationControls } from '@lar-works/design-system';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { SLOT } from './notice-slot';
import { clearToast } from './ToastActions';
import { useItemDialogStore } from '@/features/item-dialog';
import { TitleLink, useActionStore, useItemAction } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { postAction, receive } from '@/services/board/board.service';
import { buttonKind } from '@/ui/board';

/** Opens the item, as it is in the latest data, in the item dialog. Does nothing once it's gone. */
function viewItem(itemId: string): void {
    if (!useBoardStore.getState().data.items.some((i) => i.id === itemId)) return;

    // Its toast has done its job.
    clearToast(SLOT);
    useItemDialogStore.getState().open(itemId);
}

export const ViewButton = ({ item }: { item: Item }) => (
    <Button {...buttonKind('other')} data-view-item onClick={() => viewItem(item.id)}>
        View item
    </Button>
);

/** A mounted notice owns its feedback; late results only update the board after it leaves. */
export function AddedNotice({ item }: { item: Item }) {
    const current = useBoardStore((state) => state.data.items.find((value) => value.id === item.id));
    const action = useItemAction(item.id);
    const { hold, fail } = useNotificationControls();
    // 'added', 'pending', 'success', or the error that stopped it.
    const [result, setResult] = useState<string>('added');
    const mounted = useRef(true);
    const queue = useRef<HTMLButtonElement>(null);
    const view = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        mounted.current = true;

        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        hold(result !== 'added' && result !== 'success');
    }, [hold, result]);

    const failed = !['added', 'pending', 'success'].includes(result);

    useEffect(() => {
        fail(failed);
    }, [fail, failed]);

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
            useActionStore
                .getState()
                .set(item.id, answer.error ? { phase: 'error', kind: 'queue', message: answer.error } : undefined);

            if (mounted.current) setResult(answer.error ?? 'success');
        });

        if (mounted.current && focused && !answer.error) view.current?.querySelector('button')?.focus();
    };

    return (
        <>
            <span role={failed ? 'alert' : 'status'}>
                {result === 'added' ? (
                    <>
                        Added <TitleLink item={item} /> to List.
                    </>
                ) : result === 'pending' ? (
                    'Queueing…'
                ) : result === 'success' ? (
                    <>
                        Moved <TitleLink item={item} /> to Queued.
                    </>
                ) : (
                    result
                )}
            </span>{' '}
            <span ref={view}>{<ViewButton item={item} />}</span>{' '}
            {eligible && result !== 'success' && (
                <Button ref={queue} {...buttonKind('other')} aria-disabled={pending} onClick={() => void activate()}>
                    {pending ? 'Queueing…' : 'Queue'}
                </Button>
            )}
        </>
    );
}
