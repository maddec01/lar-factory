import {
    deskItems,
    deskWait,
    itemName,
    needsAnswer,
    prReadiness,
    questionWaitReason,
    supersededReleaseQuestion,
} from '@lar-factory/shared';
// Why the work waits on the user, from its work record, in the item dialog: the reason and the choices the board
// offers for it. Each choice asks in its confirmation first. Set aside is Abandon.
import type { BoardData, Item, NeedsYouAction, NeedsYouOffer } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';
import { useState } from 'react';

import { writeState } from './ActionAvailability';
import { useActionStore, useItemAction } from './ActionStore';
import { askAbandon } from './CardActions';
import { NeedsYouDialog } from './NeedsYouDialog';
import { useActivityUnavailable } from './useActivityFeedback';
import { useItemDialogStore } from '@/features/item-dialog';
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

/** What a build's PR wait asks you to do, in words the notice says; any other wait says its own word. */
const REVIEW_ASKS: Record<string, string> = {
    'Verify build': 'Check the build in its pull request.',
    'Merge PR': 'Review the pull request and merge it.',
    'Resolve conflicts': 'Resolve the pull request’s conflicts with the main branch.',
    'Checks failed': 'A check failed on the pull request: look at it before going on.',
};

export function NeedsYou({ item, data }: { item: Item; data: BoardData }) {
    const cleanupResult = useActionStore((state) => state.cleanupResults[item.id]);
    const unavailable = useActivityUnavailable();

    if (Array.isArray(item.threads) && item.threads.some((thread) => supersededReleaseQuestion(item, thread)))
        return <NeedsYouNotice reason={questionWaitReason(item)} />;

    if (!item.needsYou) {
        // A concept or parent whose parts wait on you says which, so its dialog leads with them as the board's row does.
        const parts = needsAnswer(item) ? [] : deskItems(data, unavailable).filter((part) => part.parentId === item.id);

        if (parts.length && !cleanupResult) {
            const [first] = parts;
            const what = `${deskWait(first!, unavailable, data.items).label} · ${itemName(first!)}`;

            return (
                <NeedsYouNotice
                    reason={
                        parts.length === 1
                            ? `A part waits on you: ${what}.`
                            : `${parts.length} parts wait on you, first ${what}.`
                    }
                    actions={
                        <Button {...buttonKind('next')} onClick={() => useItemDialogStore.getState().open(first!.id)}>
                            Open {first!.number ? `#${first!.number}` : 'part'}
                        </Button>
                    }
                />
            );
        }

        // A build at Verify or Ready to merge whose pull request waits on you says so, as a question does.
        const review = needsAnswer(item) ? null : prReadiness(item);

        if (review && (review.state === 'waiting' || review.state === 'failed') && !cleanupResult)
            return <NeedsYouNotice reason={REVIEW_ASKS[review.word] ?? `${review.word}.`} />;

        return needsAnswer(item) ? (
            <NeedsYouNotice reason={questionWaitReason(item)}>
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
