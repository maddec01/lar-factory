// PROTOTYPE, throwaway. Stats variant C, "Widget chips": five separate Control Center style chips, each with its own tiny graphic.

import type { ReactNode } from 'react';
import { formatUsd, platformOf, plural, shortAgo } from '@mux-factory/shared';
import type { Item } from '@mux-factory/shared';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { platformColor, StatusGlyph } from '../chrome.tsx';
import { statsOf } from '../item-bits.tsx';
import type { StatsData } from './stats-data.ts';

export const NAME = 'Widget chips';

const DAY = 86_400_000;

/** Seven daily buckets ending today, oldest first. */
function lastWeek(now: number, items: Item[], at: (i: Item) => string, weight: (i: Item) => number = () => 1): number[] {
  return Array.from({ length: 7 }, (_, d) => {
    const key = new Date(now - (6 - d) * DAY).toDateString();
    return items.filter((i) => new Date(at(i)).toDateString() === key).reduce((t, i) => t + weight(i), 0);
  });
}

/** One chip: a 32 px graphic, then number over label, with the detail in a tooltip. */
function Chip({ graphic, value, label, tip, warn }: { graphic: ReactNode; value: ReactNode; label: string; tip: ReactNode; warn?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger render={
        <button type="button"
          className={`group flex h-12 min-w-0 items-center gap-2.5 rounded-2xl border py-1.5 pr-3.5 pl-2 text-left shadow-xs transition-colors ${warn
            ? 'border-(--warning)/35 bg-(--warning-surface) hover:border-(--warning)/60'
            : 'border-(--border) bg-(--card) hover:bg-(--accent)'}`} />
      }>
        <span className={`grid size-8 shrink-0 place-items-center rounded-xl ${warn ? 'bg-(--warning)/15' : 'bg-(--soft)'}`}>{graphic}</span>
        <span className="flex min-w-0 flex-col leading-none">
          <span className={`text-[15px] font-semibold tabular-nums ${warn ? 'text-(--warning-foreground)' : 'text-(--foreground)'}`}>{value}</span>
          <span className={`mt-1 truncate text-[11px] ${warn ? 'text-(--warning-foreground)/80' : 'text-(--muted-foreground)'}`}>{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipPopup side="bottom">{tip}</TooltipPopup>
    </Tooltip>
  );
}

/** Tooltip body: a title and up to five item rows. */
function Tip({ title, items, now, empty, foot }: { title: string; items?: Item[]; now?: number; empty?: string; foot?: ReactNode }) {
  return (
    <div className="flex max-w-72 flex-col gap-1 py-0.5">
      <span className="font-medium">{title}</span>
      {items && items.length === 0 && empty && <span className="text-(--muted-foreground)">{empty}</span>}
      {items?.slice(0, 5).map((i) => (
        <span key={i.id} className="flex items-center gap-1.5">
          <StatusGlyph status={i.status} className="size-3" />
          <span className="min-w-0 flex-1 truncate">{i.title}</span>
          {now !== undefined && <span className="shrink-0 tabular-nums text-(--muted-foreground)">{shortAgo(i.closedAt ?? i.updatedAt, now)}</span>}
        </span>
      ))}
      {items && items.length > 5 && <span className="text-(--muted-foreground)">and {items.length - 5} more</span>}
      {foot && <span className="text-(--muted-foreground)">{foot}</span>}
    </div>
  );
}

/** Needs you: a stack of dots, one per item, coloured by repo. */
function Dots({ items, platform }: { items: Item[]; platform: (i: Item) => string }) {
  if (!items.length) return <svg viewBox="0 0 16 16" className="size-4 text-(--muted-foreground)"><circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2 2" /></svg>;
  const shown = items.slice(0, 3);
  return (
    <span className="flex -space-x-1.5">
      {shown.map((i) => <span key={i.id} className="size-3 rounded-full ring-2 ring-(--warning-surface)" style={{ background: platformColor(platform(i)) }} />)}
    </span>
  );
}

/** Building: a ring split into one arc per slot, filled for each running build. */
function Ring({ used, limit }: { used: number; limit: number }) {
  const r = 11, c = 2 * Math.PI * r, gap = limit > 1 ? 3 : 0, seg = c / limit - gap;
  return (
    <svg viewBox="0 0 28 28" className="size-7 -rotate-90">
      {Array.from({ length: limit }, (_, n) => (
        <circle key={n} cx="14" cy="14" r={r} fill="none" strokeWidth="3.5" strokeLinecap="round"
          stroke={n < used ? (used > limit ? 'var(--warning)' : 'var(--primary)') : 'var(--border)'}
          strokeDasharray={`${seg} ${c - seg}`} strokeDashoffset={-(n * (c / limit)) - gap / 2} />
      ))}
    </svg>
  );
}

/** Queued: stacked bars, solid for queued, faint for what still waits in List. */
function Queue({ queued, list }: { queued: number; list: number }) {
  const rows = 4, solid = Math.min(rows, queued), faint = Math.min(rows - solid, list > 0 ? Math.max(1, Math.ceil(list / 3)) : 0);
  return (
    <span className="flex w-4 flex-col-reverse gap-[2px]">
      {Array.from({ length: rows }, (_, n) => (
        <span key={n} className="h-[3px] rounded-full"
          style={{ background: n < solid ? 'var(--foreground)' : n < solid + faint ? 'var(--muted-foreground)' : 'var(--border)', opacity: n < solid ? 0.75 : n < solid + faint ? 0.4 : 1 }} />
      ))}
    </span>
  );
}

/** Shipped: seven day bars. */
function Bars({ days }: { days: number[] }) {
  const max = Math.max(1, ...days);
  return (
    <span className="flex h-4 w-5 items-end gap-[1.5px]">
      {days.map((n, i) => <span key={i} className="flex-1 rounded-[1px] bg-(--success)" style={{ height: `${Math.max(2, (n / max) * 16)}px`, opacity: n ? 1 : 0.25 }} />)}
    </span>
  );
}

/** Spend: a seven day sparkline with a soft fill. */
function Spark({ days }: { days: number[] }) {
  const max = Math.max(...days), w = 22, h = 14;
  if (!max) return <svg viewBox={`0 0 ${w} ${h}`} className="h-3.5 w-5.5"><line x1="1" y1={h - 1} x2={w - 1} y2={h - 1} stroke="var(--muted-foreground)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" /></svg>;
  const pts = days.map((v, i) => [1 + (i / 6) * (w - 2), h - 1.5 - (v / max) * (h - 3)] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const last = pts[6]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-3.5 w-5.5 overflow-visible text-(--primary)">
      <path d={`${line} L${w - 1} ${h} L1 ${h} Z`} fill="currentColor" opacity="0.15" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r="1.75" fill="currentColor" />
    </svg>
  );
}

export function StatsC({ stats }: { stats: StatsData }) {
  const { data, now, needsYou, building, buildLimit, queued, list, done, spend } = stats;
  const platform = (i: Item) => platformOf(i, data.repos);
  const inProgress = data.items.filter((i) => i.status === 'In progress');
  const shippedDays = lastWeek(now, done, (i) => i.closedAt ?? i.updatedAt);
  const priced = data.items.filter((i) => statsOf(i)?.costUsd !== undefined);
  const spendDays = lastWeek(now, priced, (i) => i.updatedAt, (i) => statsOf(i)?.costUsd ?? 0);
  const weekSpend = spendDays.reduce((a, b) => a + b, 0);
  const top = [...priced].sort((a, b) => (statsOf(b)?.costUsd ?? 0) - (statsOf(a)?.costUsd ?? 0))[0];
  const free = Math.max(0, buildLimit - building);

  return (
    <div className="grid grid-cols-5 gap-2 overflow-x-auto">
      <Chip warn={needsYou.length > 0} graphic={<Dots items={needsYou} platform={platform} />} value={needsYou.length} label="Needs you"
        tip={<Tip title={needsYou.length ? 'Only you can move these' : 'Nothing waiting on you'} items={needsYou} now={now} />} />
      <Chip graphic={<Ring used={building} limit={buildLimit} />} label="Building"
        value={<>{building}<span className="text-xs font-normal text-(--muted-foreground)">/{buildLimit}</span></>}
        tip={<Tip title={free ? `${plural(free, 'slot')} free` : 'At the in-flight limit'} items={inProgress} empty="No builds running" />} />
      <Chip graphic={<Queue queued={queued.length} list={list.length} />} label={list.length ? `Queued · +${list.length}` : 'Queued'} value={queued.length}
        tip={<Tip title={`${plural(queued.length, 'item')} queued`} items={queued} empty="Queue is empty" foot={`${list.length} more in List`} />} />
      <Chip graphic={<Bars days={shippedDays} />} value={done.length} label="Shipped · 7d"
        tip={<Tip title="Done in the last 7 days" items={done} now={now} empty="Nothing shipped this week" />} />
      <Chip graphic={<Spark days={spendDays} />} value={formatUsd(spend)} label="Spend"
        tip={<Tip title="Agent cost on open and recent items"
          foot={<>{formatUsd(weekSpend)} on items touched this week{top && <><br />Most: {top.title} ({formatUsd(statsOf(top)?.costUsd ?? 0)})</>}</>} />} />
    </div>
  );
}
