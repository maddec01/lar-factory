// PROTOTYPE, throwaway. Stats variant A, "Readout": no boxes, the five stats set as one calm line of type, each a
// tabular numeral with a small label and a micro-visual, separated by hairline dots. Hover shows the detail.

import type { ReactNode } from 'react';
import { formatUsd, plural, shortAgo } from '@mux-factory/shared';
import type { Item } from '@mux-factory/shared';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { statsOf } from '../item-bits.tsx';
import type { StatsData } from './stats-data.ts';

export const NAME = 'Readout';

const DAY = 86_400_000;

/** One stat: a micro-visual, the number and its label, with the detail in a T3 tooltip. */
function Reading({ glyph, value, label, tip, tone, trailing }: { glyph?: ReactNode; value: ReactNode; label: string; tip: ReactNode; tone?: string; trailing?: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} className="group inline-flex h-7 cursor-default items-center gap-1.5 rounded-md px-1.5 outline-none transition-colors hover:bg-(--soft) focus-visible:bg-(--soft)" />}>
        {glyph && <span className="inline-flex shrink-0 items-center">{glyph}</span>}
        <span className="text-[15px] font-semibold leading-none tracking-tight tabular-nums" style={tone ? { color: tone } : undefined}>{value}</span>
        <span className="text-xs leading-none text-(--muted-foreground) transition-colors group-hover:text-(--foreground)">{label}</span>
        {trailing}
      </TooltipTrigger>
      <TooltipPopup side="bottom" className="max-w-64">{tip}</TooltipPopup>
    </Tooltip>
  );
}

const Dot = () => <span aria-hidden="true" className="mx-1 size-[3px] shrink-0 rounded-full bg-(--muted-foreground) opacity-40" />;

/** Amber and breathing when something waits on you; a quiet ring when the desk is clear. */
function Beacon({ on }: { on: boolean }) {
  if (!on) return <span className="size-1.5 rounded-full border border-(--muted-foreground) opacity-50" />;
  return (
    <span className="relative flex size-1.5">
      <span className="absolute inset-0 animate-ping rounded-full bg-(--warning) opacity-60" />
      <span className="relative size-1.5 rounded-full bg-(--warning)" />
    </span>
  );
}

/** The in-flight slots as pips: filled for each running build, hollow for each free one. */
function Pips({ used, limit }: { used: number; limit: number }) {
  return (
    <span className="flex gap-[3px]">
      {Array.from({ length: Math.max(limit, used) }, (_, n) => (
        <span key={n} className="size-1.5 rounded-full"
          style={n < used ? { background: n >= limit ? 'var(--warning)' : 'var(--primary)' } : { boxShadow: 'inset 0 0 0 1px var(--muted-foreground)', opacity: 0.5 }} />
      ))}
    </span>
  );
}

function shippedByDay(done: Item[], now: number) {
  return Array.from({ length: 7 }, (_, d) => {
    const key = new Date(now - (6 - d) * DAY).toDateString();
    return done.filter((i) => new Date(i.closedAt ?? i.updatedAt).toDateString() === key).length;
  });
}

/** A 7-day line with a dot on today, in the success green. */
function Sparkline({ days }: { days: number[] }) {
  const w = 28, h = 12, max = Math.max(1, ...days);
  const pts = days.map((n, i) => [(i / (days.length - 1)) * (w - 3) + 1.5, h - 1.5 - (n / max) * (h - 3)] as const);
  const last = pts[pts.length - 1]!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="overflow-visible">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke="var(--success)" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
      <circle cx={last[0]} cy={last[1]} r="1.75" fill="var(--success)" />
    </svg>
  );
}

/** A short list of titles for a tooltip, with "and N more". */
function Titles({ items, max = 3 }: { items: Item[]; max?: number }) {
  if (!items.length) return null;
  return (
    <ul className="m-0 mt-1 grid list-none gap-0.5 p-0 text-(--muted-foreground)">
      {items.slice(0, max).map((i) => <li key={i.id} className="truncate">{i.title}</li>)}
      {items.length > max && <li>and {items.length - max} more</li>}
    </ul>
  );
}

export function StatsA({ stats }: { stats: StatsData }) {
  const { needsYou, building, buildLimit, queued, list, done, spend, now } = stats;
  const days = shippedByDay(done, now);
  const lastShipped = done.map((i) => i.closedAt ?? i.updatedAt).sort().at(-1);
  const priciest = stats.data.items
    .map((i) => ({ item: i, cost: statsOf(i)?.costUsd ?? 0 }))
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost)[0];
  const free = Math.max(0, buildLimit - building);

  return (
    <div className="-mx-1.5 flex h-9 items-center overflow-x-auto whitespace-nowrap">
      <Reading glyph={<Beacon on={needsYou.length > 0} />} value={needsYou.length} label="need you"
        tone={needsYou.length ? 'var(--warning-foreground)' : undefined}
        tip={needsYou.length ? <><div>Only you can move {needsYou.length === 1 ? 'this' : 'these'}</div><Titles items={needsYou} /></> : 'Nothing waits on you'} />
      <Dot />
      <Reading glyph={<Pips used={building} limit={buildLimit} />}
        value={<>{building}<span className="text-xs font-normal text-(--muted-foreground)">/{buildLimit}</span></>} label="building"
        tip={building >= buildLimit ? 'At the in-flight limit' : `${plural(free, 'slot')} free of ${buildLimit}`} />
      <Dot />
      <Reading value={queued.length} label="queued"
        tip={<><div>{queued.length ? `${plural(queued.length, 'item')} ready to build` : 'Nothing queued'}</div><div className="text-(--muted-foreground)">{list.length ? `${list.length} more in List` : 'List is empty'}</div></>}
        trailing={list.length ? <span className="text-[11px] leading-none text-(--muted-foreground) opacity-70 tabular-nums">+{list.length}</span> : undefined} />
      <Dot />
      <Reading glyph={<Sparkline days={days} />} value={done.length} label="shipped"
        tip={<><div>Done in the last 7 days</div>{lastShipped && <div className="text-(--muted-foreground)">Last one {shortAgo(lastShipped, now)}</div>}</>} />
      <Dot />
      <Reading value={formatUsd(spend)} label="spend"
        tip={<><div>Agent cost on open and recent items</div>{priciest && <div className="truncate text-(--muted-foreground)">Most: {priciest.item.title}, {formatUsd(priciest.cost)}</div>}</>} />
    </div>
  );
}
