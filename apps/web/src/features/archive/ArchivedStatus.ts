// How Archive names an item's outcome: set aside, or finished on its recorded day.

import { day, retiredPartLabel, type Item } from '@lar-factory/shared';

/** Where the work stands in Archive: set aside, or finished on its day. */
export function archivedAs(item: Item): string {
    const retired = retiredPartLabel(item);

    if (retired) return retired;

    return item.closedAt ? `Finished ${day(item.closedAt, undefined)}` : 'Finished';
}
