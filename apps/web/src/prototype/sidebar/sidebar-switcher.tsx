// PROTOTYPE, throwaway. Question: how should the left sidebar list the work, with room to breathe and with the items
// still in List? Variants of the sidebar's item area (between search and the footer), switchable with ?sidebar=,
// the floating bar or ← →.

import { useEffect, useSyncExternalStore } from 'react';
import type { SidebarProps } from './sidebar-data.ts';
import { NAME as NAME_CURRENT, SidebarCurrent } from './sidebar-current.tsx';
import { NAME as NAME_A, SidebarA } from './sidebar-a.tsx';
import { NAME as NAME_B, SidebarB } from './sidebar-b.tsx';
import { NAME as NAME_C, SidebarC } from './sidebar-c.tsx';

const VARIANTS = [
  { key: 'current', name: NAME_CURRENT, View: SidebarCurrent },
  { key: 'A', name: NAME_A, View: SidebarA },
  { key: 'B', name: NAME_B, View: SidebarB },
  { key: 'C', name: NAME_C, View: SidebarC },
];
const listeners = new Set<() => void>();
const read = () => new URLSearchParams(location.search).get('sidebar') ?? 'A';
function step(by: number) {
  const at = Math.max(0, VARIANTS.findIndex((v) => v.key === read()));
  const url = new URL(location.href);
  url.searchParams.set('sidebar', VARIANTS[(at + by + VARIANTS.length) % VARIANTS.length]!.key);
  history.replaceState(null, '', url);
  listeners.forEach((l) => l());
}

/** The sidebar's item area for the picked variant, and the switcher bar. */
export function SidebarItems(props: SidebarProps) {
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
      <variant.View {...props} />
      <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-1 rounded-full bg-black px-1.5 py-1 text-xs text-white shadow-[0_8px_30px_rgb(0_0_0/45%)] ring-1 ring-white/20 [-webkit-app-region:no-drag]">
        <button type="button" className={button} onClick={() => step(-1)} aria-label="Previous sidebar variant">←</button>
        <span className="min-w-56 px-2 text-center font-medium">
          <span className="mr-1.5 rounded bg-fuchsia-500 px-1.5 py-px font-bold">{variant.key}</span>Sidebar: {variant.name}
        </span>
        <button type="button" className={button} onClick={() => step(1)} aria-label="Next sidebar variant">→</button>
      </div>
    </>
  );
}
