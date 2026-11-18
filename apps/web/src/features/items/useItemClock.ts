// The shared clock for what an item shows of its thread's activity, which changes with the time alone only at the moments
// itemActivityChangesIn names.

import { itemActivityChangesIn } from '@lar-factory/shared';
import type { Item } from '@lar-factory/shared';

import { useClock } from '@/shared/time/useClock';

/** What `read` says of `item` at the time, read again only when what `item` shows of its thread can next change. */
export const useItemClock = <T>(item: Item, read: (now: number) => T): T =>
    useClock(read, (now) => itemActivityChangesIn(item, now));
