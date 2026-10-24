// PROTOTYPE, throwaway (branch prototype/companion-app). The floating bar that flips between the
// companion-app variants. The choice lives in ?variant= and in localStorage, so the Electron window,
// whose URL you can't edit, keeps it across reloads. ← and → cycle too.

import { useEffect, useSyncExternalStore } from 'react';

const VARIANTS = [
  { key: 'A', name: 'T3 twin: threads sidebar + item detail' },
  { key: 'C', name: 'Factory floor: repos + dashboard' },
  { key: 'E', name: 'Control room: C\'s overview + A\'s detail' },
  { key: 'off', name: 'Current board' },
] as const;
export type VariantKey = (typeof VARIANTS)[number]['key'];

const STORAGE = 'prototype.variant';
// The page tests drive the current board, so under Vitest the prototype stays off.
const FALLBACK: VariantKey = import.meta.env.MODE === 'test' ? 'off' : 'E';
const listeners = new Set<() => void>();

function read(): VariantKey {
  const wanted = new URLSearchParams(location.search).get('variant') ?? localStorage.getItem(STORAGE) ?? FALLBACK;
  return VARIANTS.find((v) => v.key === wanted)?.key ?? FALLBACK;
}

function write(key: VariantKey): void {
  localStorage.setItem(STORAGE, key);
  const url = new URL(location.href);
  url.searchParams.set('variant', key);
  history.replaceState(null, '', url);
  listeners.forEach((l) => l());
}

export function useVariant(): VariantKey {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), read);
}

function step(by: number): void {
  const at = VARIANTS.findIndex((v) => v.key === read());
  write(VARIANTS[(at + by + VARIANTS.length) % VARIANTS.length]!.key);
}

export function PrototypeSwitcher() {
  const current = useVariant();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, select, [contenteditable]')) return;
      step(event.key === 'ArrowLeft' ? -1 : 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const name = VARIANTS.find((v) => v.key === current)?.name;
  const button = 'grid h-7 w-7 place-items-center rounded-full text-white/80 hover:bg-white/15 hover:text-white';
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-black px-1.5 py-1 text-xs text-white shadow-[0_8px_30px_rgb(0_0_0/45%)] ring-1 ring-white/20 [-webkit-app-region:no-drag]">
      <button type="button" className={button} onClick={() => step(-1)} aria-label="Previous variant">←</button>
      <span className="min-w-56 px-2 text-center font-medium">
        <span className="mr-1.5 rounded bg-fuchsia-500 px-1.5 py-px font-bold">{current}</span>{name}
      </span>
      <button type="button" className={button} onClick={() => step(1)} aria-label="Next variant">→</button>
    </div>
  );
}
