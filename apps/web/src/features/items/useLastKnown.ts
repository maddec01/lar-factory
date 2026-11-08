// The warning beside an item's last known usage, with the time of the failing board read when it has one.

import { clock, day, type Item } from '@lar-factory/shared';

import { useBoardStore } from '@/services/board/board.hooks';

/**
 * While usage can't be read for this item, or for any, the sentence that says shown figures are the ones last seen; otherwise
 * null. The whole board's last read says when only while it fails, as a read that works says nothing of a failing family.
 */
export function useLastKnown(item: Item): string | null {
    const read = useBoardStore((state) => state.data.usageRead);
    const unreadable = read?.readable === false;

    if (!unreadable && item.usageState !== 'failed') return null;

    const at =
        unreadable && read.readAt ? ` from ${day(read.readAt, undefined)}, ${clock(read.readAt, undefined)}` : '';

    return `Last known figures${at}: T3 Code’s usage can’t be read now.`;
}
