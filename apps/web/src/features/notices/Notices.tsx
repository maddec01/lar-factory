import type { Item, StartedThread, Status } from '@lar-factory/shared';
import { abandonPrompt, closeTicketPrompt, ref, threadLink } from '@lar-factory/shared';
import { ButtonLink } from '@lar-works/design-system';

import { AddedNotice, ViewButton } from './AddedNotice';
import { SLOT } from './notice-slot';
import { showToast } from './ToastActions';
// What this page just did to an item, announced in a toast: added, moved or kept with View item,
// abandoned or its ticket closed, started in T3, or a Queued card's action that failed.
import type { Toast } from './Toasts';
import type { StartKind } from '@/features/items';
import { TitleLink } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { buttonKind } from '@/ui/board';

export type Notice =
    | { verb: 'Added' | 'Moved'; item: Item; to: Status }
    /** Keep left the item carrying `status` alone. */
    | { verb: 'Abandoned'; item: Item }
    /** The ticket of work Abandon set aside closed. */
    | { verb: 'Closed'; item: Item }
    /** A Queued card's Move to List (`to`), Abandon, or the ticket close after it (`ticket`) failed. */
    | { verb: 'Failed'; item: Item; to?: Status; ticket?: true; startError?: true; message: string }
    | { verb: 'Started'; item: Item; thread: StartedThread; kind: StartKind };

/** The destination uses the board's proper name, including List. */
const destination = (to: Status) => to;

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
                slot: SLOT,
                failed: true,
                what: `error for ${ref(item)}`,
                body: (
                    <>
                        Couldn’t{' '}
                        {notice.startError ? (
                            <>
                                clear the start error of <TitleLink item={item} />
                            </>
                        ) : notice.to ? (
                            <>
                                move <TitleLink item={item} /> to {destination(notice.to)}
                            </>
                        ) : notice.ticket ? (
                            <>
                                close the ticket of <TitleLink item={item} />
                            </>
                        ) : (
                            <>
                                abandon <TitleLink item={item} />
                            </>
                        )}
                        . {notice.message}
                    </>
                ),
                // Back to the button that failed.
                focusAfter: [
                    `[data-${notice.startError ? 'start' : notice.to ? 'back-to-list' : 'abandon'}="${CSS.escape(item.id)}"]`,
                ],
            };
        case 'Started': {
            const environment = useBoardStore.getState().data.t3EnvironmentId;

            return {
                slot: SLOT,
                what: `started ${ref(item)}`,
                body: (
                    <>
                        {notice.kind === 'build' ? 'Build' : 'Refining'} started for {ref(item)}.{' '}
                        {environment && (
                            <ButtonLink {...buttonKind('open')} href={threadLink(environment, notice.thread.threadId)}>
                                Open thread
                            </ButtonLink>
                        )}
                    </>
                ),
            };
        }
        default:
            if (notice.verb === 'Added' && notice.to === 'List')
                return { slot: SLOT, what: `Added ${ref(item)}`, body: <AddedNotice item={item} /> };

            return {
                slot: SLOT,
                what: `${notice.verb} ${ref(item)}`,
                body: (
                    <>
                        {notice.verb} <TitleLink item={item} /> to {destination(notice.to)}.{' '}
                        {<ViewButton item={item} />}
                    </>
                ),
            };
    }
}

export function notify(notice: Notice): void {
    showToast(toastOf(notice));
}
