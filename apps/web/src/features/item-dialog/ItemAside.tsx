// The item dialog's sidebar: the work it waits on, Dependencies, sub-tickets and the rest of its relations, and pull
// requests.

import type { BoardData, Item } from '@lar-factory/shared';
import { Text } from '@lar-works/design-system';

import { isGroupParent } from './group-parent';
import { ItemChecksSection } from './ItemChecks';
import { ItemRelations } from './ItemRelations';
import { waitsOn } from './Relations';
import { Dependencies, PrList, dependenciesOf } from '@/features/items';
import type { ItemDetailsRead } from '@/services/items/items.hooks';
import { DetailsSection, ItemDialogAside, WaitsOnList } from '@/ui/board';

export function ItemAside({
    item,
    data,
    now,
    read,
    refresh,
}: {
    item: Item;
    data: BoardData;
    now: number;
    read: ItemDetailsRead;
    refresh: () => Promise<boolean>;
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
            <ItemRelations item={item} read={read} refresh={refresh} />
            {(item.linkedPrs.length > 0 || (item.kind === 'build' && !isGroupParent(item, data.items))) && (
                <DetailsSection heading="Pull requests">
                    {item.linkedPrs.length ? (
                        <PrList
                            item={item}
                            checks={
                                item.kind === 'build' && (
                                    <ItemChecksSection key={`checks-${item.id}`} itemId={item.id} />
                                )
                            }
                        />
                    ) : (
                        <Text variant="caption" tone="muted">
                            No pull request yet
                        </Text>
                    )}
                </DetailsSection>
            )}
        </ItemDialogAside>
    );
}
