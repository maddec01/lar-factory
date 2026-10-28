// THROWAWAY #525. Three title bars and three independently selectable Queue treatments on /.
import { create } from 'zustand';
import type { BoardData, Item } from '@lar-factory/shared';

export const prototype525 = import.meta.env.DEV && import.meta.env.VITE_PROTOTYPE_525 === '1';
export const titleChoices = {
  A: ['Brand + utilities', 'T3 Code sits with the brand. Update and Settings sit apart from board actions.'],
  B: ['App menu', 'T3 Code, Update and Settings share the brand menu. An update marker stays visible.'],
  C: ['Separate app strip', 'Brand and app utilities get their own row. Scope, counters and board actions sit below.'],
} as const;
export const queueChoices = {
  outline: ['Outlined rows', 'Filled Start next, outlined row actions. Every Start refining is equal.'],
  soft: ['Soft starts', 'Filled Start next, tinted row starts, quiet Open thread.'],
  quiet: ['Quiet rows', 'Outlined Start next, text row actions. Emphasis stays on the item titles.'],
} as const;
type Variant = keyof typeof titleChoices;
type QueueChoice = keyof typeof queueChoices;
const params = new URLSearchParams(location.search);
const title = params.get('variant') ?? 'A';
const queue = params.get('queue') ?? 'outline';
export const usePrototype525 = create<{
  variant: Variant; queue: QueueChoice; update: boolean; message: string;
  choose: (key: 'variant' | 'queue' | 'update', value: string) => void;
  stub: (message: string) => void;
}>()((set) => ({
  variant: Object.hasOwn(titleChoices, title) ? title as Variant : 'A',
  queue: Object.hasOwn(queueChoices, queue) ? queue as QueueChoice : 'outline',
  update: params.get('update') !== 'idle',
  message: 'Sample data. Mutations and external links are stubbed.',
  choose: (key, value) => {
    const url = new URL(location.href);
    url.searchParams.set(key, value);
    history.replaceState(null, '', url);
    set(key === 'update' ? { update: value !== 'idle' } : key === 'variant' ? { variant: value as Variant } : { queue: value as QueueChoice });
  },
  stub: (message) => set({ message: `${message}. Prototype only; nothing changed.` }),
}));

/** Keep the sample board's relative ages, and add two Queue cases that its fixture doesn't carry. */
export function prototypeBoard(data: BoardData): BoardData {
  if (!prototype525) return data;
  const now = Date.now();
  const delta = now - Date.parse(data.fetchedAt!);
  const moveDate = (value: string | null) => value ? new Date(Date.parse(value) + delta).toISOString() : null;
  const items = data.items.map((item) => ({ ...item, updatedAt: moveDate(item.updatedAt)!, closedAt: moveDate(item.closedAt) }));
  const seed = items.find((item) => item.status === 'Queued')!;
  const blocked: Item = { ...seed, id: 'prototype-525-blocked', number: 526, title: 'Add keyboard shortcuts to player controls',
    blockers: [{ repo: seed.repo!, number: seed.number!, state: 'open' }] };
  const live: Item = { ...seed, id: 'prototype-525-thread', number: 527, title: 'Keep the playback position across devices',
    threads: [{ id: 'prototype-thread', title: 'Refining playback position', state: 'running', updated: new Date(now).toISOString() }] };
  return { ...data, error: null, fetchedAt: new Date(now).toISOString(), items: [...items, blocked, live] };
}
