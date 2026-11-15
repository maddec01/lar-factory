// The item rows a title bar counter's panel lists, with their status, project and age or trailing figure.

import type { Item } from '@lar-factory/shared';
import type { ReactNode } from 'react';

import { useItemDialogStore } from '@/features/item-dialog';
import { Age, ItemStatusGlyph, RepoCell, SourceIcon } from '@/features/items';
import { PartTitle, partRef, RowKindMark } from '@/features/line';
import { CounterAge, CounterItem, CounterList } from '@/ui/board';

/** Each item as a menu's row: its status glyph, then its reference and title (a ticketless concept part's "Part 15")
 *  on up to two lines with its repository's icon and name under it, and its age there too unless the row has a `trailing` figure at its end (a spend, a wait). `asks` is
 *  need you's list, whose group headings say the status: its rows lead with their kind and say only their project, as
 *  Your desk's do. Picking one opens the item dialog. */
export function List({
    items,
    trailing,
    asks = false,
}: {
    items: Item[];
    trailing?: (item: Item) => ReactNode;
    asks?: boolean;
}) {
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
                        asks ? (
                            <RowKindMark item={item} />
                        ) : (
                            <>
                                <ItemStatusGlyph item={item} />
                                <SourceIcon item={item} bare always />
                            </>
                        )
                    }
                    title={<PartTitle item={item} />}
                    // The title takes the row's width; its project (and age) go under it.
                    sub={
                        <CounterAge
                            project={<RepoCell item={item} />}
                            age={!trailing && !asks && <Age at={item.closedAt ?? item.updatedAt} />}
                        />
                    }
                    trailing={trailing?.(item)}
                />
            ))}
        </CounterList>
    );
}
