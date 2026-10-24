// PROTOTYPE, throwaway. Header stats variant F, "Ticker": the five stats as small two-line metrics spread across the
// header's middle, like a monitoring app's top bar. A muted label over a tabular number, a micro chart where it adds
// meaning, hairline dividers, no boxes. A container query sheds charts, then Queued, then Spend as the header narrows.

import type { ReactNode } from 'react';
import { formatUsd, plural, shortAgo } from '@mux-factory/shared';
import type { Item } from '@mux-factory/shared';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { noDrag } from '../chrome.tsx';
import { refText, statsOf } from '../item-bits.tsx';
import type { StatsData } from './stats-data.ts';

export const NAME = 'Ticker (header)';

const DAY = 86_400_000;

/** Sums `value` per calendar day over the last 7 days, oldest first. */
function byDay(items: Item[], now: number, when: (i: Item) => string, value: (i: Item) => number) {
  const keys = Array.from({ length: 7 }, (_, d) => new Date(now - (6 - d) * DAY).toDateString());
  const sums = keys.map(() => 0);
  for (const i of items) {
    const at = keys.indexOf(new Date(when(i)).toDateString());
    if (at >= 0) sums[at]! += value(i);
  }
  return sums;
}

/** One metric: label on top, number below, an optional chart beside it, the detail in a T3 tooltip. */
function Metric({ label, value, tip, tone, chart, className = '' }: { label: string; value: ReactNode; tip: ReactNode; tone?: string; chart?: ReactNode; className?: string }) {
  return (
    <div className={`flex shrink-0 items-center before:mx-1 before:h-6 before:w-px before:bg-(--border) first:before:hidden ${className}`}>
      <Tooltip>
        <TooltipTrigger render={<div tabIndex={0} className={`group flex h-10 cursor-default items-center gap-2 rounded-md px-2 outline-none transition-colors hover:bg-(--accent) focus-visible:bg-(--accent) ${noDrag}`} />}>
          <div className="grid gap-0.5">
            <span className="text-[10px] leading-none whitespace-nowrap text-(--muted-foreground) transition-colors group-hover:text-(--foreground)" style={tone ? { color: tone } : undefined}>{label}</span>
            <span className="text-sm leading-none font-semibold tracking-tight whitespace-nowrap tabular-nums" style={tone ? { color: tone } : undefined}>{value}</span>
          </div>
          {chart && <span aria-hidden="true" className="hidden self-end pb-0.5 @[440px]:block">{chart}</span>}
        </TooltipTrigger>
        <TooltipPopup side="bottom" className="max-w-72">{tip}</TooltipPopup>
      </Tooltip>
    </div>
  );
}

/** The in-flight slots as two short bars: filled per running build, amber past the limit. */
function Meter({ used, limit }: { used: number; limit: number }) {
  return (
    <span className="flex h-3.5 items-end gap-[3px]">
      {Array.from({ length: Math.max(limit, used) }, (_, n) => (
        <span key={n} className="h-full w-1 rounded-[1px]"
          style={{ background: n >= used ? 'var(--border)' : n >= limit ? 'var(--warning)' : 'var(--primary)' }} />
      ))}
    </span>
  );
}

/** A 7-day line over a faint area, with a dot on today. */
function Spark({ days, color }: { days: number[]; color: string }) {
  const w = 34, h = 14, max = Math.max(...days);
  const pts = days.map((n, i) => [1.5 + (i / (days.length - 1)) * (w - 3), h - 1.5 - (max ? n / max : 0) * (h - 3)] as const);
  const line = pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const last = pts.at(-1)!;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block overflow-visible">
      <polygon points={`1.5,${h} ${line} ${last[0]},${h}`} fill={color} opacity={0.12} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="1.75" fill={color} />
    </svg>
  );
}

/** A tooltip's heading and its quieter detail lines. */
function Tip({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return <div className="grid gap-1"><div className="font-medium">{title}</div>{children && <div className="grid gap-0.5 text-(--muted-foreground)">{children}</div>}</div>;
}

function Titles({ items, max = 4 }: { items: Item[]; max?: number }) {
  return (
    <>
      {items.slice(0, max).map((i) => <div key={i.id} className="flex gap-1.5"><span className="shrink-0 tabular-nums opacity-70">{refText(i)}</span><span className="truncate">{i.title}</span></div>)}
      {items.length > max && <div>and {items.length - max} more</div>}
    </>
  );
}

export function StatsF({ stats }: { stats: StatsData }) {
  const { data, now, needsYou, building, buildLimit, queued, list, done, spend } = stats;
  const shipped = byDay(done, now, (i) => i.closedAt ?? i.updatedAt, () => 1);
  const costed = data.items.filter((i) => (statsOf(i)?.costUsd ?? 0) > 0);
  const cost = byDay(costed, now, (i) => i.updatedAt, (i) => statsOf(i)?.costUsd ?? 0);
  const inProgress = data.items.filter((i) => i.status === 'In progress');
  const lastShipped = done.map((i) => i.closedAt ?? i.updatedAt).sort().at(-1);
  const priciest = [...costed].sort((a, b) => (statsOf(b)?.costUsd ?? 0) - (statsOf(a)?.costUsd ?? 0))[0];
  const free = Math.max(0, buildLimit - building);
  const waiting = needsYou.length > 0;

  return (
    <div className="@container w-full min-w-0 overflow-hidden">
      <div className="flex items-center justify-center">
        <Metric label="Needs you" value={needsYou.length} tone={waiting ? 'var(--warning-foreground)' : undefined}
          tip={waiting ? <Tip title={`Only you can move ${needsYou.length === 1 ? 'this' : 'these'}`}><Titles items={needsYou} /></Tip> : <Tip title="Nothing waits on you" />} />
        <Metric label="Building" value={<>{building}<span className="font-normal text-(--muted-foreground)">/{buildLimit}</span></>}
          chart={<Meter used={building} limit={buildLimit} />}
          tip={<Tip title={building >= buildLimit ? 'At the in-flight limit' : `${plural(free, 'slot')} free of ${buildLimit}`}>{inProgress.length > 0 && <Titles items={inProgress} />}</Tip>} />
        <Metric className="hidden @[320px]:flex" label="Queued"
          value={<>{queued.length}{list.length > 0 && <span className="ml-1 text-[11px] font-normal text-(--muted-foreground)">+{list.length}</span>}</>}
          tip={<Tip title={queued.length ? `${plural(queued.length, 'item')} ready to build` : 'Nothing queued'}>{list.length ? `${list.length} more in List` : 'List is empty'}</Tip>} />
        <Metric label="Shipped" value={done.length} chart={<Spark days={shipped} color="var(--success)" />}
          tip={<Tip title="Done in the last 7 days">{lastShipped ? `Last one ${shortAgo(lastShipped, now)}` : 'Nothing shipped this week'}</Tip>} />
        <Metric className="hidden @[260px]:flex" label="Spend" value={formatUsd(spend)} chart={<Spark days={cost} color="var(--primary)" />}
          tip={<Tip title="Agent cost on open and recent items">
            <div>Chart: cost by day last touched, 7 days</div>
            {priciest && <div className="truncate">Most: {priciest.title}, {formatUsd(statsOf(priciest)?.costUsd ?? 0)}</div>}
          </Tip>} />
      </div>
    </div>
  );
}
