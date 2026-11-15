// A concept's agent figures with its parts' added, as the dialog's sidebar shows them beside the concept's own.

import { itemTotal } from '@lar-factory/shared';
import type { Item, ItemStats } from '@lar-factory/shared';

import { hasFigures } from '@/features/items';
import { useBoardStore } from '@/services/board/board.hooks';

/** The concept's figures with its parts' added, when any are known; null for anything else. */
export function useConceptTotal(item: Item): ItemStats | null {
    const total = itemTotal(
        item,
        useBoardStore((state) => state.data.items),
    );

    return item.kind === 'concept' && total && total !== 'unavailable' && hasFigures(total) ? total : null;
}
