// PROTOTYPE (issue #328, throwaway): three versions of the sidebar List row, picked by `?sidebar=a|b|c`. No param is
// today's row. All three use T3's thread-row type (text-sm font-medium title, text-xs tabular age) and drop the
// ref/age out of the title's line so the title gets the width. The floating bar flips between them (← / →).

import { useEffect, useState } from 'react';
import type { Item } from '@mux-factory/shared';
import { ref, shortAgo } from '@mux-factory/shared';
import { StatusGlyph } from '../items/status-glyph.tsx';

export const SIDEBAR_VARIANTS = ['', 'a', 'b', 'c'] as const;
export type SidebarVariant = (typeof SIDEBAR_VARIANTS)[number];
const NAMES: Record<SidebarVariant, string> = { '': 'Today', a: 'A · one line, tight', b: 'B · two-line title', c: 'C · title + meta line' };

const read = (): SidebarVariant => {
  const v = new URLSearchParams(location.search).get('sidebar') ?? '';
  return (SIDEBAR_VARIANTS as readonly string[]).includes(v) ? (v as SidebarVariant) : '';
};

export function useSidebarVariant(): SidebarVariant {
  const [v, setV] = useState(read);
  useEffect(() => {
    const on = () => setV(read());
    window.addEventListener('sidebar-variant', on);
    window.addEventListener('popstate', on);
    return () => { window.removeEventListener('sidebar-variant', on); window.removeEventListener('popstate', on); };
  }, []);
  return v;
}

const go = (v: SidebarVariant) => {
  const url = new URL(location.href);
  if (v) url.searchParams.set('sidebar', v); else url.searchParams.delete('sidebar');
  history.replaceState(null, '', url);
  window.dispatchEvent(new Event('sidebar-variant'));
};

export function SidebarVariantBar() {
  const v = useSidebarVariant();
  const step = (d: number) => go(SIDEBAR_VARIANTS[(SIDEBAR_VARIANTS.indexOf(read()) + d + SIDEBAR_VARIANTS.length) % SIDEBAR_VARIANTS.length]!);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('input, textarea, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  return (
    <div data-prototype-bar className="fixed bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black px-3 py-1.5 text-xs text-white shadow-lg">
      <button type="button" aria-label="Previous sidebar variant" onClick={() => step(-1)}>←</button>
      <span className="min-w-36 text-center">sidebar: {NAMES[v]}</span>
      <button type="button" aria-label="Next sidebar variant" onClick={() => step(1)}>→</button>
    </div>
  );
}

/** Classes shared by the three rows: T3's row surface (rounded-md, hover and selected fills) and title weight. */
const surface = (on: boolean) => `w-full rounded-md text-left hover:bg-(--sidebar-row-hover) ${on ? 'bg-(--sidebar-row-selected) text-(--sidebar-foreground)' : 'text-(--sidebar-foreground)/80'}`;
const age = (item: Item, now: number) => shortAgo(item.updatedAt, now);

/** A: one line, 28 px. The ref goes (it's in the tooltip and on hover); the age shows only on hover or when selected. */
export function RowA({ item, now, on, open }: RowProps) {
  return (
    <button type="button" onClick={open} data-item={item.id} title={`${ref(item)} ${item.title}`}
      className={`group flex h-7 items-center gap-2 pl-6 pr-2 text-sm font-medium ${surface(on)}`}>
      <StatusGlyph status={item.status} />
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      <span className={`shrink-0 text-xs font-normal tabular-nums text-(--sidebar-muted-foreground) ${on ? '' : 'hidden group-hover:inline'}`}>{ref(item)} · {age(item, now)}</span>
    </button>
  );
}

/** B: the title wraps to two lines; a one-line title keeps a 32 px row. Ref leads the title, age sits top right. */
export function RowB({ item, now, on, open }: RowProps) {
  return (
    <button type="button" onClick={open} data-item={item.id}
      className={`flex min-h-8 items-start gap-2 py-1 pl-6 pr-2 text-sm font-medium leading-4 ${surface(on)}`}>
      <span className="flex h-4 items-center"><StatusGlyph status={item.status} /></span>
      <span className="line-clamp-2 min-w-0 flex-1 break-words"><span className="font-normal tabular-nums text-(--sidebar-muted-foreground)">{ref(item)}</span> {item.title}</span>
      <span className="shrink-0 text-xs font-normal tabular-nums text-(--sidebar-muted-foreground)">{age(item, now)}</span>
    </button>
  );
}

/** C: the title alone on the first line at full width; ref and age on a second, small line under it. */
export function RowC({ item, now, on, open }: RowProps) {
  return (
    <button type="button" onClick={open} data-item={item.id}
      className={`flex items-center gap-2 py-1 pl-6 pr-2 ${surface(on)}`}>
      <StatusGlyph status={item.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-[18px]">{item.title}</span>
        <span className="block truncate text-xs leading-4 tabular-nums text-(--sidebar-muted-foreground)">{ref(item)} · {age(item, now)}</span>
      </span>
    </button>
  );
}

export type RowProps = { item: Item; now: number; on: boolean; open: () => void };
