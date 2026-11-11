import type { BoardData, Item } from '@lar-factory/shared';

import { hasLiveThread, useStartHolds } from '@/features/items';

/** Whether the footer shows MoveActions: a List item's Abandon, or a Queued item's moves while no Start or thread holds it,
 *  so a footer with none leaves out their slot rather than keeping its empty line on a phone. */
export function useMovesItem(item: Item, data: BoardData): boolean {
    const startHolds = useStartHolds(item, data);

    return item.status === 'List' || (item.status === 'Queued' && !startHolds && !hasLiveThread(item));
}
