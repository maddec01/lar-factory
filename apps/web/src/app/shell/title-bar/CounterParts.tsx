// The item rows a title bar counter's panel lists, with their status, project and age or trailing figure.

import { itemName, repoKey, shortAgo } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { useItemDialogStore } from '@/features/item-dialog';
import { ItemTitle, SourceIcon, ItemStatusGlyph } from '@/features/items';
import { ProjectIcon } from '@/features/repositories';
import { CounterAge, CounterItem, CounterList } from '@/ui/board';

/** Each item as a menu's row: its status glyph, its number and title, then its repository's icon and age (or a
 *  trailing figure). Picking one opens the item dialog. */
export function List({ items, now, trailing }: { items: Item[]; now: number; trailing?: (item: Item) => ReactNode }) {
    return (
        <CounterList>
            {items.map((item) => (
                <CounterItem
                    key={item.id}
                    item={item.id}
                    label={itemName(item)}
                    onOpen={() => useItemDialogStore.getState().open(item.id)}
                    leading={
                        <>
                            <ItemStatusGlyph item={item} />
                            <SourceIcon item={item} />
                        </>
                    }
                    title={<ItemTitle item={item} />}
                    trailing={
                        trailing?.(item) ?? (
                            <CounterAge
                                icon={<ProjectIcon repo={repoKey(item)} size="sm" />}
                                age={shortAgo(item.closedAt ?? item.updatedAt, now)}
                            />
                        )
                    }
                />
            ))}
        </CounterList>
    );
}
