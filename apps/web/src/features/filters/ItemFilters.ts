// The Kind and Labels filters, which List and the board each keep on this machine. A filter only hides rows: it writes nothing
// to the tracker and matches what a row shows, so a managed label or one mapped to the row's kind never matches.

import { labelsOnRow, sameLabel, trackerCapabilities } from '@lar-factory/shared';
import type { Item, RepoConfig } from '@lar-factory/shared';
import { useState } from 'react';

import type { LabelChoice } from '@/shared/ui/labels/LabelPicker';

export const KIND_FILTERS = ['bug', 'feature', 'improvement', 'concept', 'no-kind'] as const;
export type KindFilter = (typeof KIND_FILTERS)[number];

export interface ItemFilters {
    kinds: KindFilter[];
    /** Label names as first chosen; they match without case. */
    labels: string[];
}

const isKindFilter = (value: unknown): value is KindFilter => KIND_FILTERS.includes(value as KindFilter);
const LIST_FILTERS_KEY = 'lar-board:filters:list';

export function readFilters(key: string): ItemFilters {
    try {
        const { kinds, labels } = JSON.parse(localStorage.getItem(key) ?? '{}') as {
            kinds?: unknown;
            labels?: unknown;
        };

        return {
            kinds: Array.isArray(kinds) ? kinds.filter(isKindFilter) : [],
            labels: Array.isArray(labels) ? labels.filter((label): label is string => typeof label === 'string') : [],
        };
    } catch {
        return { kinds: [], labels: [] };
    }
}

/** List's filters, stored in this browser until cleared. */
export function useItemFilters(): [ItemFilters, (filters: ItemFilters) => void] {
    const [filters, setFilters] = useState(() => readFilters(LIST_FILTERS_KEY));

    return [
        filters,
        (next) => {
            localStorage.setItem(LIST_FILTERS_KEY, JSON.stringify(next));
            setFilters(next);
        },
    ];
}

export const filtering = ({ kinds, labels }: ItemFilters): boolean => kinds.length + labels.length > 0;

export const toggled = <T>(list: readonly T[], value: T, same: (a: T, b: T) => boolean = Object.is): T[] =>
    list.some((v) => same(v, value)) ? list.filter((v) => !same(v, value)) : [...list, value];

/** With every row on one tracker, its word for labels; rows across trackers say Labels. */
export const headingOf = (rows: readonly Item[]): string => {
    const headings = new Set(rows.map((row) => trackerCapabilities(row.repo).heading));

    return headings.size === 1 ? [...headings][0]! : 'Labels';
};

/** The kind filter a row counts under. An item with no kind badge counts as No kind. */
export const kindFilterOf = (item: Pick<Item, 'kind'>): KindFilter => (isKindFilter(item.kind) ? item.kind : 'no-kind');

/** Whether a row stays: it matches any chosen kind and any chosen label. */
export const rowFilter =
    ({ kinds, labels }: ItemFilters, repos: readonly RepoConfig[]) =>
    (item: Item): boolean =>
        (!kinds.length || kinds.includes(kindFilterOf(item))) &&
        (!labels.length || labelsOnRow(item, repos).some((shown) => labels.some((label) => sameLabel(label, shown))));

/** What the Labels filter offers for `rows`: the names they show, once each without case, in order, in a colour one of them has. */
export function labelChoices(rows: readonly Item[], repos: readonly RepoConfig[]): LabelChoice[] {
    const choices = new Map<string, LabelChoice>();

    for (const row of rows) {
        for (const name of labelsOnRow(row, repos)) {
            const key = name.toLowerCase();
            const color = choices.get(key)?.color ?? row.labelColors?.[name];

            choices.set(key, { name: choices.get(key)?.name ?? name, color });
        }
    }

    return [...choices.values()].sort((a, b) => a.name.localeCompare(b.name));
}
