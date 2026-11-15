// A concept part's name and state, as every surface says them: its parts list row, map card, the concept dialog's rows,
// its own dialog and board search.

import { retiredPartLabel, type BoardData, type Item } from '@lar-factory/shared';

import { isDone } from './DossierParts';
import { partWait } from '@/features/items';

export { partRef } from '@/features/items';

/** A part's one state word: set aside or merged, Done, else what holds it ("Blocked by Part 24"), else `own`, the word
 *  its stage says. What waits on the owner is the caller's, which says it in the desk's words first. */
export const partState = (item: Item, data: BoardData, own: string): string =>
    retiredPartLabel(item) ?? (isDone(item) ? 'Done' : (partWait(item, data) ?? own));
