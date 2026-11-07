// The item dialog's sidebar: the work it waits on, Dependencies, sub-tickets and the rest of its relations, and pull
// requests.

import type { BoardData, Item } from '@lar-factory/shared';
import { DetailsSection, ItemDialogAside, WaitsOnList } from '@lar-works/design-system';

import { ItemRelations } from './ItemRelations';
import { waitsOn } from './Relations';
import type { ItemDetailsRead } from './useItemDetails';
import { Dependencies, PrList, dependenciesOf } from '@/features/items';

export function ItemAside({
    item,
    data,
    now,
    read,
}: {
    item: Item;
    data: BoardData;
    now: number;
    read: ItemDetailsRead;
}) {
    return (
        <ItemDialogAside>
            {waitsOn(item).length > 0 && (
                <DetailsSection heading="Waits on">
                    <WaitsOnList
                        items={waitsOn(item).map((b, i) => ({
                            key: b.workId ?? String(i),
                            title: b.title ?? '',
                            closed: b.state === 'closed',
                        }))}
                    />
                </DetailsSection>
            )}
            {dependenciesOf(item).length > 0 && (
                <DetailsSection heading="Dependencies">
                    <Dependencies item={item} data={data} now={now} />
                </DetailsSection>
            )}
            <ItemRelations item={item} read={read} />
            {item.linkedPrs.length > 0 && (
                <DetailsSection heading="Pull requests">
                    <PrList item={item} />
                </DetailsSection>
            )}
        </ItemDialogAside>
    );
}
