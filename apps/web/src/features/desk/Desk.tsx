import {
    deskItems,
    deskParentName,
    deskWait,
    itemName,
    openQuestionThread,
    questionOwnerParent,
    readingScope,
} from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { Loading } from '@lar-works/design-system';

import { rowFilter, useScopeStore, useShownScope } from '@/features/filters';
import { useItemDialogStore } from '@/features/item-dialog';
import { HumanWaitAction, ItemTitle, useActivityUnavailable } from '@/features/items';
import { ItemCard } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';
import { DeskCard, DeskDrawer, type DeskLatest, noteBoardPlaces } from '@/ui/board';

function latestOf(items: Item[], data: BoardData, unavailable: boolean): DeskLatest | undefined {
    const item = items.reduce<Item | undefined>(
        (latest, i) => (!latest || i.updatedAt > latest.updatedAt ? i : latest),
        undefined,
    );

    if (!item) return undefined;

    const question = (openQuestionThread(item) ?? openQuestionThread(questionOwnerParent(item, data.items) ?? item))
        ?.questionSummary;
    const parent = deskParentName(item, data.items);

    return {
        title: <ItemTitle item={item} />,
        name: itemName(item),
        detail: [
            deskWait(item, unavailable, data.items).label,
            question ??
                item.linkedPrs[0]?.review?.comments
                    ?.map((c) => c.body.slice(0, 240) || 'Changes requested')
                    .join(' · ') ??
                (parent && `in ${parent}`),
        ]
            .filter(Boolean)
            .join(' · '),
        action: <HumanWaitAction item={item} data={data} quiet />,
        onOpen: () => useItemDialogStore.getState().open(item.id),
    };
}

export function Desk({ items: inScope }: { items: Item[] }) {
    const data = useBoardStore((state) => state.data);
    const clientError = useBoardStore((state) => state.clientError);
    const unavailable = useActivityUnavailable();
    const filters = useScopeStore((state) => state.filters);
    const scoped = new Set(inScope.map((item) => item.id));
    const shows = rowFilter(filters, data.repos);
    const items = deskItems(data, unavailable).filter((item) => scoped.has(item.id) && shows(item));
    const scope = useShownScope();

    noteBoardPlaces('desk', new Map(deskItems(data, unavailable).map((item) => [item.id, 0])), data.firstRead.settled);

    return (
        <DeskDrawer
            count={items.length}
            latest={latestOf(items, data, unavailable)}
            empty={
                clientError ? (
                    'Nothing waited on you at the last read.'
                ) : readingScope(data, scope ?? undefined) ? (
                    <Loading presentation="inline" label="Loading projects…" />
                ) : deskItems(data, unavailable).length ? (
                    'Nothing on your desk matches the filters.'
                ) : (
                    'Nothing waits on you.'
                )
            }
        >
            {items.map((i) => (
                <DeskCard key={i.id} item={i.id}>
                    <ItemCard item={i} data={data} />
                </DeskCard>
            ))}
        </DeskDrawer>
    );
}
