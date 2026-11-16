// What a piece of work at it is doing, in one word, the same on a lane row, a parts-list row and a card: a build names
// its phase (Planning, Implementing, Checks…), one in review says Review, and a thread at work otherwise says Shaping or
// Working. Its bar shows while it has one, so work at it always draws a bar even with no slices to count.

import { buildPhaseLabel } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

/** What `item` is at while it runs, or undefined when nothing runs; `working` is whether its thread is at work now. */
export function workLabel(item: Item, working: boolean): string | undefined {
    if (['In progress', 'Review'].includes(item.status))
        return buildPhaseLabel(item.buildPhase) ?? (item.status === 'Review' ? 'Review' : 'Working');

    if (!working) return undefined;

    return item.status === 'Shaping' ? 'Shaping' : 'Working';
}
