// PROTOTYPE, throwaway. Sidebar variant C, "two-line rows": room comes from richer rows, not more groups. A repo
// strip on top scopes the view and filters the list; then "In flight" (yours first) and a quieter, collapsible "List".
// Each row: glyph and `#23 Title`, then muted meta (repo, status, slices, age).

import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { STATUSES, platformOf, shortAgo } from '@mux-factory/shared';
import type { Item, Status } from '@mux-factory/shared';
import { StatusGlyph, platformColor } from '../chrome.tsx';
import { ItemTitle, refText } from '../item-bits.tsx';
import { matches } from './sidebar-data.ts';
import type { Pick, SidebarProps } from './sidebar-data.ts';

export const NAME = 'Two-line rows';
const YOURS: Status[] = ['Needs you', 'Verify', 'Ready to merge'];
const time = (i: Item) => Date.parse(i.updatedAt);
// Yours first, then the furthest along, then the freshest.
const flightOrder = (a: Item, b: Item) =>
  Number(YOURS.includes(b.status)) - Number(YOURS.includes(a.status)) || STATUSES.indexOf(b.status) - STATUSES.indexOf(a.status) || time(b) - time(a);

function Row({ item, platform, now, pick, quiet }: { item: Item; platform: string; now: number; pick: Pick; quiet?: boolean }) {
  const on = pick.id === item.id;
  const done = item.slices.filter((s) => s.progress === 'done').length;
  return (
    <button type="button" onClick={() => pick.set(item.id)}
      className={`flex w-full min-w-0 flex-col gap-1 rounded-md px-2 py-2 text-left hover:bg-(--row-hover) ${on ? 'bg-(--row-active)' : ''}`}>
      <span className="flex w-full min-w-0 items-center gap-2">
        <StatusGlyph status={item.status} className="size-3.5" />
        <span className={`min-w-0 flex-1 truncate ${on ? 'font-medium' : quiet ? 'text-(--sidebar-muted)' : ''}`}><ItemTitle item={item} /></span>
      </span>
      <span className="flex w-full min-w-0 items-center gap-1.5 pl-5.5 text-[11px] text-(--sidebar-muted)">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: platformColor(platform) }} />
        <span className="min-w-0 shrink-[2] truncate">{platform}</span>
        {!quiet && <><span aria-hidden>·</span><span className="min-w-0 truncate">{item.status}</span></>}
        {item.slices.length > 0 && <><span aria-hidden>·</span><span className="shrink-0 whitespace-nowrap tabular-nums">{done}/{item.slices.length} slices</span></>}
        <span className="ml-auto shrink-0 whitespace-nowrap pl-1 tabular-nums">{shortAgo(item.updatedAt, now)}</span>
      </span>
    </button>
  );
}

function Section({ label, count, open, onToggle, children }: { label: string; count: number; open: boolean; onToggle?: () => void; children: ReactNode }) {
  return (
    <section className="mt-3">
      <button type="button" onClick={onToggle} disabled={!onToggle}
        className="flex h-7 w-full items-center gap-1.5 rounded-md px-2 text-left text-xs font-medium text-(--sidebar-muted) enabled:hover:bg-(--row-hover)">
        <span className="flex-1 truncate">{label}</span>
        <span className="tabular-nums">{count}</span>
        {onToggle && (open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />)}
      </button>
      {open && <div className="mt-1 flex flex-col gap-1">{children}</div>}
    </section>
  );
}

export function SidebarC({ data, now, query: q, platform, onScope, pick }: SidebarProps) {
  const [listOpen, setListOpen] = useState(true);
  const of = (i: Item) => platformOf(i, data.repos);
  const open = data.items.filter((i) => i.status !== 'Done');
  const shown = open.filter((i) => (!platform || of(i) === platform) && matches(i, q, refText(i)));
  const flight = shown.filter((i) => i.status !== 'List').sort(flightOrder);
  const list = shown.filter((i) => i.status === 'List').sort((a, b) => time(b) - time(a));
  const tabs = [{ key: null, label: 'All', count: open.length }, ...data.repos.map((r) => ({ key: r.platform, label: r.platform, count: open.filter((i) => of(i) === r.platform).length }))];
  return (
    <nav className="flex min-h-0 flex-1 flex-col px-2">
      <div className="flex shrink-0 gap-0.5 rounded-lg bg-(--row-hover) p-0.5">
        {tabs.map((t) => (
          <button key={t.label} type="button" onClick={() => onScope(t.key === null || platform === t.key ? null : t.key)}
            className={`flex h-6 min-w-0 flex-1 items-center justify-center gap-1 rounded-md px-1 text-xs ${platform === t.key ? 'bg-(--row-active) font-medium shadow-xs' : 'text-(--sidebar-muted) hover:text-(--sidebar-fg)'}`}>
            {t.key && <span className="size-1.5 shrink-0 rounded-full" style={{ background: platformColor(t.key) }} />}
            <span className="truncate">{t.label}</span>
            <span className="shrink-0 text-[10px] tabular-nums opacity-70">{t.count}</span>
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        {flight.length > 0 && <Section label="In flight" count={flight.length} open>{flight.map((i) => <Row key={i.id} item={i} platform={of(i)} now={now} pick={pick} />)}</Section>}
        {list.length > 0 && (
          <Section label="List" count={list.length} open={listOpen || !!q} onToggle={q ? undefined : () => setListOpen(!listOpen)}>
            {list.map((i) => <Row key={i.id} item={i} platform={of(i)} now={now} pick={pick} quiet />)}
          </Section>
        )}
        {!flight.length && !list.length && <p className="px-2 py-6 text-center text-xs text-(--sidebar-muted)">{q ? 'Nothing matches.' : 'Nothing here.'}</p>}
      </div>
    </nav>
  );
}
