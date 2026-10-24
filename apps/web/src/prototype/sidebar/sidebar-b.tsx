// PROTOTYPE, throwaway. Sidebar variant B "By stage": no repo groups; every repo's items sit together under T3-style
// section headers by what happens next (Needs you, Building, Review, Queued, then List, capped with "Show N more").
// A dot marks each row's repo; repo chips on top scope the main view and filter the list. 36 px rows, as T3's threads.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { platformOf, shortAgo } from '@mux-factory/shared';
import type { Item, Status } from '@mux-factory/shared';
import { StatusGlyph, platformColor } from '../chrome.tsx';
import { ItemTitle, refText } from '../item-bits.tsx';
import { matches } from './sidebar-data.ts';
import type { SidebarProps } from './sidebar-data.ts';

export const NAME = 'By stage';
const STAGES: { name: string; statuses: Status[] }[] = [
  { name: 'Needs you', statuses: ['Needs you', 'Verify', 'Ready to merge'] },
  { name: 'Building', statuses: ['In progress', 'Shaping', 'Ready'] },
  { name: 'Review', statuses: ['Review'] },
  { name: 'Queued', statuses: ['Queued'] },
  { name: 'List', statuses: ['List'] },
];
const CAP = 3; // List rows shown before "Show N more"

function Chip({ label, color, active, onClick }: { label: string; color?: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex h-6 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs ${active ? 'bg-(--row-active) font-medium text-(--sidebar-fg) shadow-xs ring-1 ring-(--sidebar-border)' : 'text-(--sidebar-muted) hover:bg-(--row-hover) hover:text-(--sidebar-fg)'}`}>
      {color && <span className="size-1.5 rounded-full" style={{ background: color }} />}{label}
    </button>
  );
}

function Row({ item, platform, now, active, onClick }: { item: Item; platform: string; now: number; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={`${platform} · ${item.status}`}
      className={`flex min-h-9 w-full items-center gap-2.5 rounded-md px-2.5 py-1 text-left hover:bg-(--row-hover) ${active ? 'bg-(--row-active) font-medium' : ''}`}>
      <StatusGlyph status={item.status} className="size-3.5" />
      <span className={`min-w-0 flex-1 truncate ${active ? '' : 'text-(--sidebar-muted)'}`}><ItemTitle item={item} /></span>
      <span className="size-1.5 shrink-0 rounded-full" style={{ background: platformColor(platform) }} />
      <span className="shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-(--sidebar-muted)">{shortAgo(item.updatedAt, now)}</span>
    </button>
  );
}

function Section({ name, items, capped, children }: { name: string; items: Item[]; capped: boolean; children: (i: Item) => ReactNode }) {
  const [open, setOpen] = useState(true);
  const [all, setAll] = useState(false);
  const shown = capped && !all ? items.slice(0, CAP) : items;
  return (
    <section className="mb-3">
      <button type="button" onClick={() => setOpen(!open)}
        className="group flex h-8 w-full items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-(--sidebar-muted) hover:bg-(--row-hover) hover:text-(--sidebar-fg)">
        <span className="flex-1 truncate text-left">{name}</span>
        <span className="tabular-nums">{items.length}</span>
        {open ? <ChevronDown className="size-3 opacity-0 group-hover:opacity-100" /> : <ChevronRight className="size-3" />}
      </button>
      {open && (
        <div className="flex flex-col gap-0.5">
          {shown.map(children)}
          {shown.length < items.length && (
            <button type="button" onClick={() => setAll(true)} className="flex h-8 items-center rounded-md px-2.5 pl-8 text-left text-xs text-(--sidebar-muted) hover:bg-(--row-hover) hover:text-(--sidebar-fg)">
              Show {items.length - shown.length} more
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function SidebarB({ data, now, query: q, platform, onScope, pick }: SidebarProps) {
  const of = (i: Item) => platformOf(i, data.repos);
  const items = data.items.filter((i) => (!platform || of(i) === platform) && matches(i, q, refText(i)));
  return (
    <nav className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap gap-1 px-3 pb-3 pt-1">
        <Chip label="All" active={!platform} onClick={() => onScope(null)} />
        {data.repos.map((r) => <Chip key={r.repo} label={r.platform} color={platformColor(r.platform)} active={platform === r.platform} onClick={() => onScope(platform === r.platform ? null : r.platform)} />)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {STAGES.map((s) => {
          const rows = items.filter((i) => s.statuses.includes(i.status)).sort((a, b) => s.statuses.indexOf(a.status) - s.statuses.indexOf(b.status) || b.updatedAt.localeCompare(a.updatedAt));
          if (!rows.length) return null;
          return (
            <Section key={`${s.name}${q ? '?' : ''}`} name={s.name} items={rows} capped={s.name === 'List' && !q}>
              {(i) => <Row key={i.id} item={i} platform={of(i)} now={now} active={pick.id === i.id} onClick={() => pick.set(i.id)} />}
            </Section>
          );
        })}
        {!items.some((i) => i.status !== 'Done') && <p className="px-2.5 py-2 text-xs text-(--sidebar-muted)">{q ? 'Nothing matches.' : 'Nothing here.'}</p>}
      </div>
    </nav>
  );
}
