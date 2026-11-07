// The List's sorts, by the label its sort menu shows.

import type { Item } from '@lar-factory/shared';

export const SORTS = {
    updated: { label: 'Recently updated', compare: (a: Item, b: Item) => b.updatedAt.localeCompare(a.updatedAt) },
    oldest: { label: 'Oldest', compare: (a: Item, b: Item) => a.updatedAt.localeCompare(b.updatedAt) },
    title: { label: 'Title', compare: (a: Item, b: Item) => a.title.localeCompare(b.title) },
    priority: {
        label: 'Backlog priority',
        compare: (a: Item, b: Item) => (a.sourceOrder ?? Infinity) - (b.sourceOrder ?? Infinity),
    },
} as const;

export type Sort = keyof typeof SORTS;

/** The sorts, in the menu's order, as its options. */
export const SORT_OPTIONS = (Object.keys(SORTS) as Sort[]).map((value) => ({ value, label: SORTS[value].label }));
