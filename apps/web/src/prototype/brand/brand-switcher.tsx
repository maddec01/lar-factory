// PROTOTYPE, throwaway. Question: how should the sidebar's brand row read, aligned with T3's title bar, and say this
// app is for T3 Code? Variants of what sits in the row after the sidebar toggle, switchable with ?brand=, the
// floating bar or ← →.

import { useEffect, useSyncExternalStore } from 'react';
import { BrandCurrent, NAME as NAME_CURRENT } from './brand-current.tsx';
import { BrandA, NAME as NAME_A } from './brand-a.tsx';
import { BrandB, NAME as NAME_B } from './brand-b.tsx';
import { BrandC, NAME as NAME_C } from './brand-c.tsx';

const VARIANTS = [
  { key: 'current', name: NAME_CURRENT, View: BrandCurrent },
  { key: 'A', name: NAME_A, View: BrandA },
  { key: 'B', name: NAME_B, View: BrandB },
  { key: 'C', name: NAME_C, View: BrandC },
];
const listeners = new Set<() => void>();
const read = () => new URLSearchParams(location.search).get('brand') ?? 'A';
function step(by: number) {
  const at = Math.max(0, VARIANTS.findIndex((v) => v.key === read()));
  const url = new URL(location.href);
  url.searchParams.set('brand', VARIANTS[(at + by + VARIANTS.length) % VARIANTS.length]!.key);
  history.replaceState(null, '', url);
  listeners.forEach((l) => l());
}

/** The brand row's content for the picked variant, and the switcher bar. */
export function BrandSlot() {
  const key = useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read);
  const variant = VARIANTS.find((v) => v.key === key) ?? VARIANTS[1]!;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      step(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const button = 'grid h-7 w-7 place-items-center rounded-full text-white/80 hover:bg-white/15 hover:text-white';
  return (
    <>
      <variant.View />
      <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-black px-1.5 py-1 text-xs text-white shadow-[0_8px_30px_rgb(0_0_0/45%)] ring-1 ring-white/20 [-webkit-app-region:no-drag]">
        <button type="button" className={button} onClick={() => step(-1)} aria-label="Previous brand variant">←</button>
        <span className="min-w-56 px-2 text-center font-medium">
          <span className="mr-1.5 rounded bg-fuchsia-500 px-1.5 py-px font-bold">{variant.key}</span>Brand: {variant.name}
        </span>
        <button type="button" className={button} onClick={() => step(1)} aria-label="Next brand variant">→</button>
      </div>
    </>
  );
}
