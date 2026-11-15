import type { Item } from '@lar-factory/shared';

import { partRef } from './PartState';
import { ItemTitle } from '@/ui/board';

/** A part's title led by its reference, "#139" or "Part 15", as blockers and Start after name it. */
export function PartTitle({ item }: { item: Item }) {
    return <ItemTitle reference={partRef(item)} title={item.title} />;
}
