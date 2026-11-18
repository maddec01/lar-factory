import { approvedMoveRefusal, approvedUnbuilt } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';

import { hasLiveThread, useShownStart, useStartHolds } from '@/features/items';

/** Whether the footer shows MoveActions: a List item's Abandon, a Queued item's moves while no Start or thread holds it,
 *  or approved unbuilt work's moves while no Start is pending or uncertain and the server's rule allows them, so a footer
 *  with none leaves out their slot rather than keeping its empty line on a phone. */
export function useMovesItem(item: Item, data: BoardData): boolean {
    const startHolds = useStartHolds(item, data);
    const shaping = useShownStart(item, data, 'refine');
    const build = useShownStart(item, data, 'build');

    if (item.setAside) return false;

    if (approvedUnbuilt(item))
        return ![shaping, build].some((start) => start.pending || start.uncertain) && !approvedMoveRefusal(item);

    return item.status === 'List' || (item.status === 'Queued' && !startHolds && !hasLiveThread(item));
}
