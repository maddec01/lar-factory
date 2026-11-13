import { itemName, needsAnswer, openQuestionThread } from '@lar-factory/shared';
// Why the work waits on the user, from its work record, in the item dialog: the reason and the choices the board
// offers for it. Each choice asks in its confirmation first. Set aside is Abandon.
import type { BoardData, Item, NeedsYouAction, NeedsYouOffer } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';
import { useState } from 'react';

import { writeState } from './ActionAvailability';
import { useActionStore, useItemAction } from './ActionStore';
import { askAbandon } from './CardActions';
import { NeedsYouDialog } from './NeedsYouDialog';
import { buttonKind, NeedsYouNotice, NeedsYouResult } from '@/ui/board';

const LABELS: Record<NeedsYouOffer, string> = {
    'start-again': 'Start again',
    'back-to-queue': 'Back to Queue',
    'back-to-list': 'Move to List',
    'reopen-pr': 'Reopen PR',
    'replace-pr': 'Start a replacement build',
    'keep-working': 'Keep working',
    'mark-handled': 'Mark as handled',
    'set-aside': 'Abandon',
};

export function NeedsYou({ item, data }: { item: Item; data: BoardData }) {
    const cleanupResult = useActionStore((state) => state.cleanupResults[item.id]);

    if (!item.needsYou) {
        const thread = openQuestionThread(item);
        const summary = thread?.questionSummary;

        return needsAnswer(item) ? (
            <NeedsYouNotice
                reason={
                    summary || 'This work is waiting for your answer or decision. Open the thread in T3 to continue.'
                }
            >
                {cleanupResult && <NeedsYouResult>{cleanupResult}</NeedsYouResult>}
            </NeedsYouNotice>
        ) : cleanupResult ? (
            <NeedsYouResult>{cleanupResult}</NeedsYouResult>
        ) : null;
    }

    return <Notice item={item} notice={item.needsYou} data={data} cleanupResult={cleanupResult} />;
}

function Notice({
    item,
    notice,
    data,
    cleanupResult,
}: {
    item: Item;
    notice: NonNullable<Item['needsYou']>;
    data: BoardData;
    cleanupResult?: string;
}) {
    const [asking, setAsking] = useState<NeedsYouAction | null>(null);
    const state = writeState(data, useItemAction(item.id));

    return (
        <NeedsYouNotice
            reason={notice.reason}
            actions={notice.offers.map((offer) => (
                <Button
                    {...buttonKind('other', offer === 'set-aside' ? 'danger' : undefined)}
                    key={offer}
                    {...state}
                    aria-label={`${LABELS[offer]}: ${itemName(item)}`}
                    {...(offer === 'set-aside'
                        ? { 'data-abandon': item.id, onClick: () => askAbandon(item.id) }
                        : { 'data-needs-you': item.id, onClick: () => setAsking(offer) })}
                >
                    {LABELS[offer]}
                </Button>
            ))}
        >
            {cleanupResult && <NeedsYouResult>{cleanupResult}</NeedsYouResult>}
            {asking && notice.offers.includes(asking) && (
                <NeedsYouDialog
                    item={item}
                    data={data}
                    offer={asking}
                    label={LABELS[asking]}
                    onClose={() => setAsking(null)}
                />
            )}
        </NeedsYouNotice>
    );
}

/** The desk uses the same confirmed recovery as the notice in item details. */
export function StartAgain({ item, data }: { item: Item; data: BoardData }) {
    const [open, setOpen] = useState(false);
    const state = writeState(data, useItemAction(item.id));

    if (!item.needsYou?.offers.includes('start-again')) return null;

    return (
        <>
            <Button {...buttonKind('next')} {...state} onClick={() => setOpen(true)}>
                Start again
            </Button>
            {open && (
                <NeedsYouDialog
                    item={item}
                    data={data}
                    offer="start-again"
                    label="Start again"
                    onClose={() => setOpen(false)}
                />
            )}
        </>
    );
}
