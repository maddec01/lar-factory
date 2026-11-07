// Your desk: the items awaiting your action, including shaping and concept questions, as small cards in one row that
// scrolls sideways under the page's padding to the window's edges. A card opens the item dialog. Every card has the
// same four rows at the same heights, so they line up across cards: source, repository, kind and age, in a stage
// row's order; the title; the status and next step; and the card's action in the right corner, with Open thread as an
// icon beside it. Scope, Kind and Labels narrow the cards. An empty desk is one small line, which while the board is
// disconnected only speaks for the last read, during a first read that may still add items is the loader, and says so
// when Scope, Kind and Labels hide every card.

import { deskItems, needsAnswer, openQuestionThread, HINTS, itemPr, itemName, readingScope } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { DeskCard as Card, DeskHint, DeskMergeState, DeskSection, Loading } from '@lar-works/design-system';

import { rowFilter, useScopeStore, useShownScope } from '@/features/filters';
import { useItemDialogStore } from '@/features/item-dialog';
import {
    Age,
    AzureFields,
    ItemTitle,
    useActivityUnavailable,
    OpenThread,
    PrLink,
    ItemStatusGlyph,
} from '@/features/items';
import { RowKind, RowSource } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';

/**
 * The line beside the card's action: nothing when that action answers the question, else the merge state and checks of the PR Open PR opens, or the status's hint. The checks
 * leave out a zero count other than passed.
 */
function NextStep({ item }: { item: Item }) {
    if (needsAnswer(item)) return null;

    const pipeline = itemPr(item)?.pipeline;

    if (pipeline) {
        const { checks, mergeState } = pipeline;
        const counts = checks
            ? [
                  `${checks.passed} passed`,
                  checks.running && `${checks.running} running`,
                  checks.failed && `${checks.failed} failed`,
              ]
                  .filter(Boolean)
                  .join(' · ')
            : 'no checks';

        return <DeskMergeState state={mergeState} checks={counts} />;
    }

    return <DeskHint>{HINTS[item.status]}</DeskHint>;
}

/** The card's action, and Open thread as a square icon in the right corner unless it is the action. */
function Actions({ item, data }: { item: Item; data: BoardData }) {
    return needsAnswer(item) ? (
        <OpenThread item={item} data={data} threadId={openQuestionThread(item)?.id} label="Answer in T3" />
    ) : (
        <>
            <PrLink item={item} label="Open PR" />
            <OpenThread item={item} data={data} iconOnly />
        </>
    );
}

function DeskCard({ item, data }: { item: Item; data: BoardData }) {
    const picked = useItemDialogStore((state) => state.itemId === item.id);

    return (
        <Card
            item={item.id}
            picked={picked}
            onOpen={() => useItemDialogStore.getState().open(item.id)}
            source={<RowSource item={item} />}
            kind={<RowKind item={item} />}
            age={<Age at={item.updatedAt} />}
            title={<ItemTitle item={item} />}
            name={itemName(item)}
            details={<AzureFields azure={item.azure} />}
            statusIcon={<ItemStatusGlyph item={item} />}
            status={item.status}
            next={<NextStep item={item} />}
            actions={<Actions item={item} data={data} />}
        />
    );
}

/** `inScope` are the items in the main area's scope. */
export function Desk({ items: inScope }: { items: Item[] }) {
    const data = useBoardStore((state) => state.data);
    const clientError = useBoardStore((state) => state.clientError);
    const unavailable = useActivityUnavailable();
    const filters = useScopeStore((state) => state.filters);
    const items = deskItems({ ...data, items: inScope }, unavailable).filter(rowFilter(filters, data.repos));
    const scope = useShownScope();

    return (
        <DeskSection
            title="Your desk"
            count={items.length}
            empty={
                clientError ? (
                    'Nothing waited on you at the last read.'
                ) : readingScope(data, scope ?? undefined) ? (
                    <Loading presentation="inline" label="Loading Projects…" />
                ) : deskItems(data, unavailable).length ? (
                    'Nothing on your desk matches the filters.'
                ) : (
                    'Nothing waits on you.'
                )
            }
        >
            {items.map((i) => (
                <DeskCard key={i.id} item={i} data={data} />
            ))}
        </DeskSection>
    );
}
