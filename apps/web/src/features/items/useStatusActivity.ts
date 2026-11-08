// Whether an item's status glyph animates: the one item-state presenter's answer, for many items at once.

import type { Item } from '@lar-factory/shared';

import { useItemStates } from './ItemState';

/** Current execution for status icons, including delegated work after its parent turn ends. */
export function useStatusActivity(): (item: Item) => boolean {
    const states = useItemStates();

    return (item) => states(item).running;
}
