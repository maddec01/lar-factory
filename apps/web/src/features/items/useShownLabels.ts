// The labels an item's row shows under its repository's mappings, following changes to the board's repositories.

import { labelsOnRow, type Item } from '@lar-factory/shared';

import { useBoardStore } from '@/services/board/board.hooks';

export type LabelledItem = Pick<Item, 'kind' | 'labels' | 'labelColors' | 'repo'>;

/** The labels of `item` that its row shows, under its repository's mappings. */
export function useShownLabels(item: LabelledItem): string[] {
    return labelsOnRow(
        item,
        useBoardStore((state) => state.data.repos),
    );
}
