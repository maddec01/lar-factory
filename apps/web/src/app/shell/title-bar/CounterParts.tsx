// The item rows a title bar counter's panel lists, with their status, project and age or trailing figure.

import { itemName, itemRepoNames, repoKey, shortAgo } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { useItemDialogStore } from '@/features/item-dialog';
import { ItemTitle, SourceIcon, ItemStatusGlyph } from '@/features/items';
import { RowKindMark } from '@/features/line';
import { ProjectIcon } from '@/features/repositories';
import { useBoardStore } from '@/services/board/board.hooks';
import { CounterAge, CounterItem, CounterList } from '@/ui/board';

/** Each item as a menu's row: its status glyph, its number and title, then its repository's icon, name and age (or a
 *  trailing figure). `asks` is need you's list, whose group headings say the status: its rows lead with their kind
 *  and say only their project, as Your desk's do. Picking one opens the item dialog. */
export function List({
    items,
    now,
    trailing,
    asks = false,
}: {
    items: Item[];
    now: number;
    trailing?: (item: Item) => ReactNode;
    asks?: boolean;
}) {
    const repos = useBoardStore((state) => state.data.repos);

    return (
        <CounterList>
            {items.map((item) => (
                <CounterItem
                    key={item.id}
                    item={item.id}
                    label={itemName(item)}
                    onOpen={() => useItemDialogStore.getState().open(item.id)}
                    leading={
                        asks ? (
                            <RowKindMark item={item} />
                        ) : (
                            <>
                                <ItemStatusGlyph item={item} />
                                <SourceIcon item={item} bare />
                            </>
                        )
                    }
                    title={<ItemTitle item={item} />}
                    trailing={
                        trailing?.(item) ?? (
                            <CounterAge
                                icon={<ProjectIcon repo={repoKey(item)} size="sm" />}
                                name={itemRepoNames(item, repos)}
                                age={asks ? undefined : shortAgo(item.closedAt ?? item.updatedAt, now)}
                            />
                        )
                    }
                />
            ))}
        </CounterList>
    );
}
