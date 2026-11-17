// How Archive sorts an item, set aside or finished, and what it says of it beyond its section: the work it merged into,
// or the day it finished.

import { day, retiredPartLabel, type Item } from '@lar-factory/shared';

/** Archive's two sections: work set aside, which Restore can bring back, and finished work hidden from the board. */
export type ArchiveSection = 'setAside' | 'finished';

/** The Archive section `item` sits in. */
export const archiveSection = (item: Item): ArchiveSection => (item.archived?.setAside ? 'setAside' : 'finished');

/** What Archive says of where the work stands beyond its section's heading: the work set-aside work merged into, or
 *  the day finished work closed; nothing when the heading says it all. */
export function archivedAs(item: Item): string | undefined {
    if (item.closeReason) return `Closed ${item.closeReason}`;

    const retired = retiredPartLabel(item);

    if (retired && retired !== 'Set aside') return retired;

    return archiveSection(item) === 'finished' && item.closedAt ? day(item.closedAt, undefined) : undefined;
}
