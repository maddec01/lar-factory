// How Archive names an item's outcome: set aside, or finished on its recorded day.

import { day, type Item } from '@lar-factory/shared';

/** Where the work stands in Archive: set aside, or finished on its day. */
export function archivedAs(item: Item): string {
    if (item.archived?.setAside) return 'Set aside';

    return item.closedAt ? `Finished ${day(item.closedAt, undefined)}` : 'Finished';
}
