// Full snapshots still arrive at the same pace. Reuse their unchanged values so a tick or an update to one item
// doesn't invalidate every settings, repository and item selector. No freshness field is omitted from comparison.

import type { BoardData } from '@lar-factory/shared';

/** Shares equal JSON values, also accepting the optional undefined fields of an action's in-memory board. */
function share(before: unknown, after: unknown): unknown {
    if (Object.is(before, after)) return before;

    if (Array.isArray(before) && Array.isArray(after)) {
        const values = after.map((value, i) => share(before[i], value));

        return before.length === values.length && values.every((value, i) => Object.is(value, before[i]))
            ? before
            : values;
    }

    if (
        before &&
        after &&
        typeof before === 'object' &&
        typeof after === 'object' &&
        !Array.isArray(before) &&
        !Array.isArray(after)
    ) {
        const old = before as Record<string, unknown>;
        const next = after as Record<string, unknown>;
        const keys = Object.keys(next);
        let equal = keys.length === Object.keys(old).length;
        const entries = keys.map((key) => {
            const value = share(old[key], next[key]);

            equal &&= Object.hasOwn(old, key) && Object.is(value, old[key]);

            return [key, value];
        });

        return equal ? before : Object.fromEntries(entries);
    }

    return after;
}

export function shareBoardData(before: BoardData | null | undefined, after: BoardData): BoardData {
    if (!before) return after;

    const previous = new Map(before.items.map((item) => [item.id, item]));
    const items = after.items.map((item) => share(previous.get(item.id), item) as typeof item);
    const sharedItems =
        before.items.length === items.length && items.every((item, i) => item === before.items[i])
            ? before.items
            : items;
    // Items are already shared by ID, including through insertion and reordering; don't walk them again by index.
    const { items: _, ...fields } = after;
    const shared = share(before, { ...fields, items: before.items }) as BoardData;

    return sharedItems === shared.items ? shared : { ...shared, items: sharedItems };
}
