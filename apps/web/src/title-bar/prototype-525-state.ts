// THROWAWAY #525. Three app-utility placements on /. Soft Queue styling is settled.
import { create } from 'zustand';
import type { BoardData, Item } from '@lar-factory/shared';

export const prototype525 = import.meta.env.DEV && import.meta.env.VITE_PROTOTYPE_525 === '1';
export const titleChoices = {
  A: ['Brand + utilities', 'T3 Code sits with the brand. Update and Settings sit apart from board actions.'],
  B: ['App utility rail', 'App utilities stay in a left rail. Board work keeps the title bar; the rail costs 144px of width, or 48px when compact.'],
  C: ['Bottom status bar', 'App utilities stay below the work area. Update availability remains visible; the status bar costs 40px of height.'],
} as const;
export const softQueue = 'Filled Start next, tinted row starts, quiet Open thread. Chosen for every layout.';
type Variant = keyof typeof titleChoices;
const params = new URLSearchParams(location.search);
const title = params.get('variant') ?? 'A';
export const usePrototype525 = create<{
  variant: Variant; update: boolean; message: string;
  choose: (key: 'variant' | 'update', value: string) => void;
  stub: (message: string) => void;
}>()((set) => ({
  variant: Object.hasOwn(titleChoices, title) ? title as Variant : 'A',
  update: params.get('update') !== 'idle',
  message: 'Sample data. Mutations and external links are stubbed.',
  choose: (key, value) => {
    const url = new URL(location.href);
    url.searchParams.set(key, value);
    url.searchParams.set('queue', 'soft');
    history.replaceState(null, '', url);
    set(key === 'update' ? { update: value !== 'idle' } : { variant: value as Variant });
  },
  stub: (message) => set({ message: `${message}. Prototype only; nothing changed.` }),
}));

/** Keep relative ages and realistic variation in both Queue and desk. All extra cases are sample-only. */
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
  const ready = items.find((item) => item.status === 'Ready')!;
  const held: Item = { ...ready, id: 'prototype-525-ready-blocked', number: 528,
    title: 'Restore playback after the media server reconnects without losing the selected audio track',
    parent: null, threads: [], blockers: [{ repo: ready.repo!, number: 149, state: 'open' }] };
  return { ...data, error: null, fetchedAt: new Date(now).toISOString(), items: [...items, blocked, live, held] };
}
