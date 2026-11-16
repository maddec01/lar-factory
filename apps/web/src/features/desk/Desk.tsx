// Your desk: the items awaiting your action, including shaping and concept questions, as a list of rows on the stage
// rows' columns: status light, kind and title, project, then what it waits for and its age, and its action at the end,
// with Open thread as an icon beside it. A row opens the item dialog. Scope, Kind and Labels narrow the rows. An empty desk is one small line, which while the board is
// disconnected only speaks for the last read, during a first read that may still add items is the loader, and says so
// when Scope, Kind and Labels hide every card.

import { deskItems, readingScope } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { Loading } from '@lar-works/design-system';

import { rowFilter, useScopeStore, useShownScope } from '@/features/filters';
import { useActivityUnavailable } from '@/features/items';
import { ItemCard } from '@/features/line';
import { useBoardStore } from '@/services/board/board.hooks';
import { DeskCard, DeskSection, HeaderEmpty, noteBoardPlaces } from '@/ui/board';

/** `inScope` are the items in the main area's scope. */
export function Desk({ items: inScope }: { items: Item[] }) {
    const data = useBoardStore((state) => state.data);
    const clientError = useBoardStore((state) => state.clientError);
    const unavailable = useActivityUnavailable();
    const filters = useScopeStore((state) => state.filters);
    const scoped = new Set(inScope.map((item) => item.id));
    const shows = rowFilter(filters, data.repos);
    const items = deskItems(data, unavailable).filter((item) => scoped.has(item.id) && shows(item));
    const scope = useShownScope();

    // A card that lands on the desk pulses once, whatever the scope and filters show.
    noteBoardPlaces('desk', new Map(deskItems(data, unavailable).map((item) => [item.id, 0])), data.firstRead.settled);

    return (
        <DeskSection
            title="Your desk"
            count={items.length}
            loading={items.length === 0 && readingScope(data, scope ?? undefined)}
            empty={
                <HeaderEmpty>
                    {clientError ? (
                        'Nothing waited on you at the last read.'
                    ) : readingScope(data, scope ?? undefined) ? (
                        <Loading presentation="inline" label="Loading projects…" />
                    ) : deskItems(data, unavailable).length ? (
                        'Nothing on your desk matches the filters.'
                    ) : (
                        'Nothing waits on you.'
                    )}
                </HeaderEmpty>
            }
        >
            {items.map((i) => (
                // The board's one card, the same as on a concept's work map (ItemCard).
                <DeskCard key={i.id} item={i.id}>
                    <ItemCard item={i} data={data} />
                </DeskCard>
            ))}
        </DeskSection>
    );
}
