// The parts of the title bar's counters the board composes: the item rows a counter's panel lists and the spend
// counter's face. The counter, its panel and their look are the design system's (BoardCounter and its parts).

import { itemName, repoKey, shortAgo } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';
import { CounterAge, CounterDash, CounterItem, CounterList, CounterPartial, Loading } from '@lar-works/design-system';
import type { ReactNode } from 'react';

import { useItemDialogStore } from '@/features/item-dialog';
import { ItemTitle, SourceIcon, ItemStatusGlyph } from '@/features/items';
import { ProjectIcon } from '@/features/repositories';

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
                                icon={<ProjectIcon repo={repoKey(item)} size="small" />}
                                age={shortAgo(item.closedAt ?? item.updatedAt, now)}
                            />
                        )
                    }
                />
            ))}
        </CounterList>
    );
}

/** What the spend counter says: a figure once it knows one, marked with a plus while it covers only part of the usage. */
export function spendFace(figure: string, known: boolean, unavailable: boolean, loading: boolean) {
    const partial = known && (unavailable || loading);
    const why = unavailable ? 'Some usage is unavailable.' : 'Some usage is still loading.';

    return {
        partial,
        notice: partial
            ? `Partial figures. ${why}`
            : unavailable
              ? 'Usage is unavailable.'
              : loading
                ? 'Usage totals are still loading.'
                : null,
        value: partial ? (
            <CounterPartial figure={figure} unavailable={unavailable} />
        ) : unavailable ? (
            <CounterDash />
        ) : loading ? (
            <Loading presentation="inline" title="Usage totals are still loading."  />
        ) : (
            figure
        ),
        sub: partial ? `${figure} so far` : unavailable ? 'Unavailable' : loading ? 'Loading' : figure,
    };
}
