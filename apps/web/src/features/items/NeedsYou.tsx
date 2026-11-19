import {
    deskItems,
    deskWait,
    itemName,
    needsAnswer,
    prReadiness,
    questionWaitReason,
    supersededReleaseQuestion,
} from '@lar-factory/shared';
// Why the work waits on the user, from its work record, in the item dialog: the reason in its notice, and the choices
// the board offers for it in the dialog's footer. Each choice asks in its confirmation first. Set aside is Abandon.
import type { BoardData, Item, NeedsYouAction, NeedsYouOffer } from '@lar-factory/shared';
import { Button } from '@lar-works/design-system';
import { ArrowRightIcon } from '@lar-works/design-system/icons';
import { useState } from 'react';

import { writeState } from './ActionAvailability';
import { useActionStore, useItemAction } from './ActionStore';
import { askAbandon } from './CardActions';
import { NeedsYouDialog } from './NeedsYouDialog';
import { useActivityUnavailable } from './useActivityFeedback';
import { useItemDialogStore } from '@/features/item-dialog';
import { NeedsYouNotice, NeedsYouResult, useButtonKind } from '@/ui/board';

const LABELS: Record<NeedsYouOffer, string> = {
    'start-again': 'Start again',
    'back-to-queue': 'Back to Queue',
    'back-to-list': 'Move to the List',
    'reopen-pr': 'Reopen PR',
    'replace-pr': 'Start a replacement build',
    'keep-working': 'Keep working',
    'mark-handled': 'Mark as handled',
    'set-aside': 'Abandon',
};

/** What a build's PR wait asks you to do, in words the notice says; any other wait says its own word. */
const REVIEW_ASKS: Record<string, string> = {
    'Verify build': 'Verify the build in its pull request.',
    'Review PR': 'Review the pull request before it can merge.',
    'Merge PR': 'Review the pull request and merge it.',
    'Resolve conflicts': 'Resolve the pull request’s conflicts with the main branch.',
    'Checks failed': 'A check failed on the pull request: look at it before going on.',
};

/** Why the work waits on you, in words only: the dialog's footer carries every action that answers it. */
export function NeedsYou({ item, data }: { item: Item; data: BoardData }) {
    const cleanupResult = useActionStore((state) => state.cleanupResults[item.id]);
    const unavailable = useActivityUnavailable();
    const kindOf = useButtonKind();

    if (Array.isArray(item.threads) && item.threads.some((thread) => supersededReleaseQuestion(item, thread)))
        return <NeedsYouNotice reason={questionWaitReason(item)} />;

    if (!item.needsYou) {
        // A concept or parent whose parts wait on you says which, so its dialog leads with them as the board's row does.
        const parts = needsAnswer(item) ? [] : deskItems(data, unavailable).filter((part) => part.parentId === item.id);

        if (parts.length && !cleanupResult) {
            const [first] = parts;
            const wait = deskWait(first!, unavailable, data.items).label;
            const what =
                wait === 'Question'
                    ? `${itemName(first!)} has a question`
                    : `${itemName(first!)} waits on you: ${wait.toLowerCase()}`;

            return (
                <NeedsYouNotice
                    reason={parts.length === 1 ? `${what}.` : `${parts.length} parts wait on you. First, ${what}.`}
                    actions={
                        <Button
                            {...kindOf('open')}
                            leftIcon={<ArrowRightIcon />}
                            onClick={() => useItemDialogStore.getState().open(first!.id)}
                        >
                            Open {first!.number ? `#${first!.number}` : 'part'}
                        </Button>
                    }
                />
            );
        }

        // A build at Verify or Ready to merge whose pull request waits on you says so; Retro is optional.
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

    return <Notice notice={item.needsYou} cleanupResult={cleanupResult} />;
}

function Notice({ notice, cleanupResult }: { notice: NonNullable<Item['needsYou']>; cleanupResult?: string }) {
    return (
        <NeedsYouNotice reason={notice.reason}>
            {cleanupResult && <NeedsYouResult>{cleanupResult}</NeedsYouResult>}
        </NeedsYouNotice>
    );
}

/** The choices that move work back or set it aside, which sit at the left of the dialog's footer with its other moves. */
const MOVES: readonly NeedsYouOffer[] = ['set-aside', 'back-to-queue', 'back-to-list'];

/** Whether the notice offers a choice for the footer's `side`: its moves at the left, or its own action at the right. */
export const offersChoices = (item: Item, side: 'moves' | 'main') =>
    !item.setAside && !!item.needsYou?.offers.some((offer) => MOVES.includes(offer) === (side === 'moves'));

/**
 * A Needs you notice's choices in the dialog's footer, as every status's actions sit there: `moves` gives Abandon, Back to
 * Queue and Move to the List at the left, `main` the action that answers the notice at the right, the first as the
 * footer's Main button. Each asks in its confirmation first.
 */
export function NeedsYouChoices({ item, data, side }: { item: Item; data: BoardData; side: 'moves' | 'main' }) {
    const [asking, setAsking] = useState<NeedsYouAction | null>(null);
    const offers = (item.needsYou?.offers ?? []).filter((offer) => MOVES.includes(offer) === (side === 'moves'));
    const ordered = side === 'moves' ? MOVES.filter((offer) => offers.includes(offer)) : offers;

    if (item.setAside || !ordered.length) return null;

    return (
        <>
            {ordered.map((offer, index) => (
                <OfferButton
                    key={offer}
                    item={item}
                    data={data}
                    offer={offer}
                    main={side === 'main' && index === 0}
                    ask={setAsking}
                />
            ))}
            {asking && ordered.includes(asking) && (
                <NeedsYouDialog
                    item={item}
                    data={data}
                    offer={asking}
                    label={LABELS[asking]}
                    onClose={() => setAsking(null)}
                />
            )}
        </>
    );
}

/** One of a notice's choices: the footer's Main button, an Other, or Abandon in the quiet-destructive recipe. */
function OfferButton({
    item,
    data,
    offer,
    main,
    ask,
}: {
    item: Item;
    data: BoardData;
    offer: NeedsYouOffer;
    main: boolean;
    ask: (offer: NeedsYouAction) => void;
}) {
    const state = writeState(data, useItemAction(item.id));
    const kindOf = useButtonKind();

    return (
        <Button
            {...(offer === 'set-aside' ? kindOf('other', 'danger') : kindOf(main ? 'main' : 'other'))}
            {...state}
            aria-label={`${LABELS[offer]}: ${itemName(item)}`}
            {...(offer === 'set-aside'
                ? { 'data-abandon': item.id, onClick: () => askAbandon(item.id) }
                : { 'data-needs-you': item.id, onClick: () => ask(offer as NeedsYouAction) })}
        >
            {LABELS[offer]}
        </Button>
    );
}

/** The desk uses the same confirmed recovery as the footer in item details, outlined as a yellow card's action is. */
export function StartAgain({ item, data }: { item: Item; data: BoardData }) {
    const [open, setOpen] = useState(false);
    const state = writeState(data, useItemAction(item.id));
    const kindOf = useButtonKind();

    if (!item.needsYou?.offers.includes('start-again')) return null;

    return (
        <>
            <Button {...kindOf('other')} {...state} data-start-again={item.id} onClick={() => setOpen(true)}>
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
