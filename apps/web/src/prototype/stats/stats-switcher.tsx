// PROTOTYPE, throwaway. Question: how should the control room's five stats (Needs you, Building, Queued, Shipped,
// Spend) look? Four variants in the stats slot, switchable with ?stats=, the floating bar or ← →.

import { useEffect, useSyncExternalStore } from 'react';
import type { StatsData } from './stats-data.ts';
import { StatsStrip } from './stats-strip.tsx';
import { NAME as NAME_A, StatsA } from './stats-a.tsx';
import { NAME as NAME_B, StatsB } from './stats-b.tsx';
import { NAME as NAME_C, StatsC } from './stats-c.tsx';

const VARIANTS = [
  { key: 'strip', name: 'Strip (current)', View: StatsStrip },
  { key: 'A', name: NAME_A, View: StatsA },
  { key: 'B', name: NAME_B, View: StatsB },
  { key: 'C', name: NAME_C, View: StatsC },
];
const listeners = new Set<() => void>();
const read = () => new URLSearchParams(location.search).get('stats') ?? 'A';
function step(by: number) {
  const at = Math.max(0, VARIANTS.findIndex((v) => v.key === read()));
  const url = new URL(location.href);
  url.searchParams.set('stats', VARIANTS[(at + by + VARIANTS.length) % VARIANTS.length]!.key);
  history.replaceState(null, '', url);
  listeners.forEach((l) => l());
}

export function Stats({ stats }: { stats: StatsData }) {
  const key = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      step(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const variant = VARIANTS.find((v) => v.key === key) ?? VARIANTS[1]!;
  const button = 'grid h-7 w-7 place-items-center rounded-full text-white/80 hover:bg-white/15 hover:text-white';
  return (
    <>
      <variant.View stats={stats} />
      <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-black px-1.5 py-1 text-xs text-white shadow-[0_8px_30px_rgb(0_0_0/45%)] ring-1 ring-white/20 [-webkit-app-region:no-drag]">
        <button type="button" className={button} onClick={() => step(-1)} aria-label="Previous stats variant">←</button>
        <span className="min-w-56 px-2 text-center font-medium">
          <span className="mr-1.5 rounded bg-fuchsia-500 px-1.5 py-px font-bold">{variant.key}</span>Stats: {variant.name}
        </span>
        <button type="button" className={button} onClick={() => step(1)} aria-label="Next stats variant">→</button>
      </div>
    </>
  );
}
