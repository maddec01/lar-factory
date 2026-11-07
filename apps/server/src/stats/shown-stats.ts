// The figures each item shows across stats reads: retained, frozen in a merged PR's block, or provisional while a read may
// still move records between items, when the figures shown before stay held for the first final read.

import type { Item, ItemStats } from '@lar-factory/shared';

import { mergedStats, retainStats } from '../github/pr-stats.ts';

const isProvisional = (stats: Item['stats']): boolean => typeof stats === 'object' && !!stats.provisional;

/** `overcounted` names the work whose retained stats count a deleted thread, until a fresh read replaces them. */
export function createShownStats(overcounted: ReadonlySet<string>) {
    /** While an item shows provisional figures, the figures retention may keep instead; the first read past that replaces them. */
    const held = new Map<string, Item['stats']>();

    return {
        /**
         * The figures an item shows: the ones frozen in its latest merged linked PR's block once no linked PR is open, else those of
         * `read`, the latest stats read, when there is one to show, else those it already showed. `withStats` false leaves them alone.
         */
        shown: (
            item: Item,
            before: Item['stats'],
            withStats: boolean,
            read?: { live: Item['stats']; provisional: boolean },
        ): Item['stats'] => {
            const recount = withStats && overcounted.has(item.id);
            const previous = recount ? undefined : isProvisional(before) ? held.get(item.id) : before;
            const carried = isProvisional(item.stats) ? undefined : item.stats;
            const known = recount ? undefined : retainStats(previous, carried);
            // Until transcripts are first read, no usage read has failed: the item's figures are still to come.
            const live = read ? read.live : recount ? undefined : carried;
            // A read that reads no stats says nothing of the figures already showing.
            const kept = (): Item['stats'] => (isProvisional(before) ? before : (known ?? previous));
            const shown = (): Item['stats'] => {
                if (!withStats) return kept();

                const merged = mergedStats({ ...item, stats: known }, read?.provisional ? undefined : live);

                if (merged) return merged;

                if (!read) return kept();

                const figures = retainStats(known, live);

                return read.provisional && typeof live === 'object'
                    ? { ...(figures as ItemStats), provisional: true }
                    : figures;
            };
            const stats = shown();

            if (isProvisional(stats)) held.set(item.id, previous);
            else held.delete(item.id);

            return stats;
        },
        /** Forgets the figures held for items no longer on the board, `ids`. */
        prune: (ids: ReadonlySet<string>): void => {
            for (const id of held.keys()) if (!ids.has(id)) held.delete(id);
        },
    };
}
