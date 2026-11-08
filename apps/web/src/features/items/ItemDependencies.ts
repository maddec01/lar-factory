// The Dependencies recorded on an item's blockers, including those the user has marked met.

import type { DependencyHold, Item } from '@lar-factory/shared';

/** The Dependencies holding the item, met or not. */
export const dependenciesOf = (item: Item): DependencyHold[] =>
    item.blockers.flatMap((b) => (b.dependency ? [b.dependency] : []));
