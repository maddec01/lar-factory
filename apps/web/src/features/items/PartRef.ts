import { ref, type Item } from '@lar-factory/shared';

/** A part's reference: its ticket's number, else its part number, so "Blocked by Part 15" points at a part the reader
 *  can find; undefined when it has neither. */
export const partRef = (item: Pick<Item, 'number' | 'title' | 'partOrder'>): string | undefined =>
    item.number ? ref(item) : item.partOrder ? `Part ${item.partOrder}` : undefined;
