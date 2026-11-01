// The Kind and Labels filters List and the board each keep on this machine. A filter only hides rows: it writes nothing
// to the tracker and matches what a row shows, so a managed label or one mapped to the row's kind never matches.

import { useState } from 'react';
import { labelsOnRow, sameLabel } from '@lar-factory/shared';
import type { Item, RepoConfig } from '@lar-factory/shared';
import type { LabelChoice } from '../labels/label-picker.tsx';

export const KIND_FILTERS = ['bug', 'feature', 'improvement', 'concept', 'no-kind'] as const;
export type KindFilter = (typeof KIND_FILTERS)[number];

export interface ItemFilters {
  kinds: KindFilter[];
  /** Label names as first chosen; they match without case. */
  labels: string[];
}

type FilterSurface = 'list' | 'board';

const isKindFilter = (value: unknown): value is KindFilter => KIND_FILTERS.includes(value as KindFilter);
const storageKey = (surface: FilterSurface) => `lar-board:filters:${surface}`;

function readFilters(surface: FilterSurface): ItemFilters {
  try {
    const { kinds, labels } = JSON.parse(localStorage.getItem(storageKey(surface)) ?? '{}') as { kinds?: unknown; labels?: unknown };
    return {
      kinds: Array.isArray(kinds) ? kinds.filter(isKindFilter) : [],
      labels: Array.isArray(labels) ? labels.filter((label): label is string => typeof label === 'string') : [],
    };
  } catch {
    return { kinds: [], labels: [] };
  }
}

/** One surface's filters, stored in this browser until cleared. */
export function useItemFilters(surface: FilterSurface): [ItemFilters, (filters: ItemFilters) => void] {
  const [filters, setFilters] = useState(() => readFilters(surface));
  return [filters, (next) => {
    localStorage.setItem(storageKey(surface), JSON.stringify(next));
    setFilters(next);
  }];
}

export const filtering = ({ kinds, labels }: ItemFilters): boolean => kinds.length + labels.length > 0;


/** Whether a row stays: it matches any chosen kind and any chosen label. An item with no kind badge counts as No kind. */
export const rowFilter = ({ kinds, labels }: ItemFilters, repos: readonly RepoConfig[]) => (item: Item): boolean =>
  (!kinds.length || kinds.includes(isKindFilter(item.kind) ? item.kind : 'no-kind'))
  && (!labels.length || labelsOnRow(item, repos).some((shown) => labels.some((label) => sameLabel(label, shown))));

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
