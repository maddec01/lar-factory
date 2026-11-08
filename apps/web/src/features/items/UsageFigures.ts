// Whether an item's usage has figures to show, is still loading or can't be read. Frozen figures stay final.

import type { BoardData, Item, ItemStats } from '@lar-factory/shared';

/** Whether figures say anything: all-zero ones say no more than having none. */
export const hasFigures = (s: ItemStats) => Boolean(s.agentMs || s.wallMs || s.tokens || s.costUsd);

/**
 * Whether the item's figures are still to come: its usage is loading, a read can still replace its provisional figures, or
 * no stats read has reached its threads yet. Figures frozen at merge are final, and a settled read with nothing, or no thread,
 * is known empty. Figures stay provisional while a never-observed thread keeps failing, which no coming read answers.
 */
export const usageLoading = (
    { stats, usageState, threads }: Item,
    { firstRead, items }: Pick<BoardData, 'firstRead' | 'items'>,
): boolean => {
    if (typeof stats === 'object' && stats.frozen) return false;

    if (usageState === 'loading') return true;

    if (typeof stats === 'object' && stats.provisional)
        return !firstRead.settled || items.some((other) => other.usageState === 'loading');

    return !usageState && stats === undefined && Array.isArray(threads) && threads.length > 0;
};

/** Whether T3's usage can't be read for this item: an item known to have no thread has none to lose. */
export const usageUnreadable = (item: Item): boolean =>
    (item.stats === 'unavailable' || (item.usageState === 'failed' && !(item.stats && hasFigures(item.stats)))) &&
    !(Array.isArray(item.threads) && !item.threads.length);
