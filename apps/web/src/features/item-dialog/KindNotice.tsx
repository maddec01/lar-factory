// The item dialog's notice for an item whose kind and its ticket's disagree, with its two answers.

import { kindSwapAccessProblem, sameRepo, trackerCapabilities } from '@lar-factory/shared';
import type { Item, KindTicketSwap, SwapKind } from '@lar-factory/shared';
import { Alert, Button, InlineLink, Text } from '@lar-works/design-system';
import { useEffect, useState } from 'react';

import { useKindChangeStore } from './KindChangeStore';
import { KIND_BADGES } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';
import { SAMPLE_READ_ONLY } from '@/services/board/board.service';
import { forgetItemDetails, type ItemDetailsRead } from '@/services/items/items.hooks';
import { buttonKind, KindQuestion } from '@/ui/board';

const kindName = (value: SwapKind) => KIND_BADGES[value]!.name;

/** What an update changes on the ticket, in the tracker's own words, and `note`, what it leaves alone and why. */
function swapLine(item: Item, { add, remove, type }: KindTicketSwap, note: string): string {
    const { noun } = trackerCapabilities(item.repo);
    const parts = [
        ...(add.length || remove.length
            ? [`${noun} ${remove.join(', ') || 'none'} → ${add.join(', ') || 'none'}`]
            : []),
        ...(type ? [`type ${type.from ?? 'none'} → ${type.to}`] : []),
    ];

    if (parts.length) return `Update changes #${item.number}: ${parts.join(', ')}.${note}`;

    return note
        ? `Update writes nothing to #${item.number}.${note}`
        : `Update writes nothing to #${item.number}, as ${kindName(item.kind as SwapKind)} has no mapped ${noun} or type.`;
}

/**
 * How the item's kind and its ticket's disagree and the two answers, worded from whichever side moved. A kept answer holds until
 * either kind changes and leaves a line whose Change shows the choice again here, with the answer standing until a new one replaces it.
 * What an update writes comes from the details, which know the team's backlog, and only while their plan is for the kinds on show. Otherwise
 * they are read again once for these kinds, and Update waits. The board's own read can't say, so it stands in only if that finds no plan.
 */
export function KindNotice({
    item,
    read,
    refresh,
}: {
    item: Item;
    read: ItemDetailsRead;
    refresh: () => Promise<boolean>;
}) {
    const disagreement = item.kindDisagreement;
    const saving = useKindChangeStore((state) => state.changes[item.id]?.saving);
    const answering = useKindChangeStore((state) => state.answers[item.id]);
    const setup = useBoardStore((state) => state.data.repos.find((r) => sameRepo(r.repo, item.repo))?.setup);
    const [reopened, setReopened] = useState(false);
    const [readFor, setReadFor] = useState<string | null>(null);
    const kinds = `${item.kind} ${disagreement?.ticketKind}`;
    const held = read.state === 'loaded' ? read.details.kindPlan : undefined;
    const plan = held?.itemKind === item.kind && held.ticketKind === disagreement?.ticketKind ? held : undefined;
    const planStale =
        disagreement?.changed === 'item' &&
        (!disagreement.kept || reopened) &&
        read.state === 'loaded' &&
        !plan &&
        readFor !== kinds;

    useEffect(() => {
        if (!planStale) return;

        let current = true;

        forgetItemDetails(item.id);
        void refresh().then(() => {
            if (current) setReadFor(kinds);
        });

        return () => {
            current = false;
        };
    }, [planStale, kinds, item.id, refresh]);

    if (!disagreement) return null;

    const { ticketKind, changed, kept } = disagreement;
    const { swap, note } = plan ?? { swap: disagreement.swap, note: '' };
    const { start, answer } = useKindChangeStore.getState();

    if (kept && !reopened) {
        return (
            <Text variant="caption" tone="muted" data-kind-kept ownLine>
                {ticketKind ? `Ticket says ${kindName(ticketKind)}. Kept as is.` : 'Ticket has no kind. Left as is.'}{' '}
                <InlineLink onClick={() => setReopened(true)}>Change</InlineLink>
            </Text>
        );
    }

    const mine = kindName(item.kind as SwapKind);
    const said = ticketKind && kindName(ticketKind);
    const keep = () => {
        setReopened(false);
        void answer(item.id, 'keep', ticketKind);
    };
    const busy = saving || answering?.saving;
    const ticketMoved = changed === 'ticket' && said !== null;
    const checking = !ticketMoved && (read.state === 'loading' || planStale);
    const shaped = `Shaping decided this is ${mine === 'Improvement' ? 'an' : 'a'} ${mine}.`;
    const problem = ticketMoved
        ? null
        : kindSwapAccessProblem(item.repo, swap, setup?.access ?? {}, { azureReadOnly: setup?.azureReadOnly });

    return (
        <KindQuestion
            data-kind-notice
            message={
                ticketMoved
                    ? `The ticket now says ${said}. This item still says ${mine}.`
                    : `${shaped} ${said ? `The ticket still says ${said}.` : 'The ticket has no kind.'}`
            }
            actions={
                <>
                    {ticketMoved ? (
                        <Button
                            {...buttonKind('other')}
                            disabled={busy}
                            onClick={() => void answer(item.id, 'update-item', ticketKind)}
                        >
                            Update item to {said}
                        </Button>
                    ) : (
                        <Button
                            {...buttonKind('other')}
                            disabled={busy || checking || problem !== null}
                            onClick={() => void start(item.id, item.kind as SwapKind)}
                        >
                            {said ? `Update ticket to ${mine}` : `Add ${mine} to ticket`}
                        </Button>
                    )}
                    <Button {...buttonKind('other')} disabled={busy} onClick={keep}>
                        {ticketMoved ? `Keep item as ${mine}` : said ? `Keep ticket as ${said}` : 'Leave ticket as is'}
                    </Button>
                </>
            }
        >
            <Text variant="caption" tone="muted" data-kind-notice-hint>
                {ticketMoved
                    ? 'Changes this item only. Nothing is written to the ticket.'
                    : checking
                      ? 'Checking what the update changes…'
                      : (problem ?? swapLine(item, swap, note))}
            </Text>
            {answering?.error && (
                <Alert size="sm" tone={answering.error === SAMPLE_READ_ONLY ? 'warning' : 'danger'}>
                    {answering.error}
                </Alert>
            )}
        </KindQuestion>
    );
}
