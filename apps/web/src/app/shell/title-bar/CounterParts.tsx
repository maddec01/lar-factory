import type { Item } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { useItemDialogStore } from '@/features/item-dialog';
import { Age, ItemStatusGlyph, RepoCell, SourceIcon } from '@/features/items';
import { PartTitle, partRef } from '@/features/line';
import { CounterAge, CounterItem, CounterList } from '@/ui/board';

export function List({ items, trailing }: { items: Item[]; trailing?: (item: Item) => ReactNode }) {
    const picked = useItemDialogStore((state) => state.itemId);

    return (
        <CounterList>
            {items.map((item) => (
                <CounterItem
                    key={item.id}
                    item={item.id}
                    picked={picked === item.id}
                    label={[partRef(item), item.title].filter(Boolean).join(' ')}
                    onOpen={() => useItemDialogStore.getState().open(item.id)}
                    leading={
                        <>
                            <ItemStatusGlyph item={item} />
                            <SourceIcon item={item} bare always />
                        </>
                    }
                    title={<PartTitle item={item} />}
                    sub={
                        <CounterAge
                            project={<RepoCell item={item} />}
                            age={!trailing && <Age at={item.closedAt ?? item.updatedAt} />}
                        />
                    }
                    trailing={trailing?.(item)}
                />
            ))}
        </CounterList>
    );
}
