// PROTOTYPE, throwaway. Stats variant B, "Flow bar": every open item as one thin stacked bar by stage, List to
// Shipped, so where the work piles up reads at a glance. Each stage's count sits above its segment; Building shows
// its in-flight slots; Spend is a quiet figure at the right end. Hover a segment for its items.

import { formatUsd, plural, shortAgo } from '@mux-factory/shared';
import type { Item, Status } from '@mux-factory/shared';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { StatusGlyph } from '../chrome.tsx';
import { statsOf } from '../item-bits.tsx';
import type { StatsData } from './stats-data.ts';

export const NAME = 'Flow bar';

interface Stage {
  key: string;
  label: string;
  glyph: Status;
  items: Item[];
  color: string;
  note: string;
  /** Text tone for the count: only Needs you and an over-limit Building speak up. */
  tone?: string;
  /** When set, the bar is drawn as in-flight slots instead of one segment. */
  slots?: { used: number; limit: number };
  /** Draws the eye: a soft halo around the segment. */
  loud?: boolean;
  /** Past work, set a little apart from the open pipe. */
  apart?: boolean;
  /** Dates in the tooltip: when it closed, else when it last moved. */
  when?: (i: Item) => string;
}

const SHOWN = 5;

function ItemList({ stage, now }: { stage: Stage; now: number }) {
  const shown = stage.items.slice(0, SHOWN);
  return (
    <div className="flex w-64 flex-col gap-1.5 py-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1.5 font-medium"><StatusGlyph status={stage.glyph} className="size-3" />{stage.label} <span className="tabular-nums text-(--muted-foreground)">{stage.items.length}</span></span>
        <span className="truncate text-(--muted-foreground)">{stage.note}</span>
      </div>
      {shown.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {shown.map((i) => (
            <li key={i.id} className="flex min-w-0 items-center gap-1.5">
              <StatusGlyph status={i.status} className="size-3" />
              <span className="min-w-0 flex-1 truncate">{i.title}</span>
              <span className="shrink-0 tabular-nums text-(--muted-foreground)">{shortAgo(stage.when?.(i) ?? i.updatedAt, now)}</span>
            </li>
          ))}
        </ul>
      )}
      {stage.items.length > SHOWN && <span className="text-(--muted-foreground)">+{stage.items.length - SHOWN} more</span>}
    </div>
  );
}

/** Building's bar: one pip per slot, primary while under the limit, amber past it, soft where a slot is free. */
function Slots({ used, limit }: { used: number; limit: number }) {
  const total = Math.max(used, limit);
  return (
    <span className="relative flex h-1.5 w-full gap-0.5">
      {Array.from({ length: total }, (_, n) => (
        <span key={n} className="h-full flex-1 rounded-full"
          style={{ background: n >= used ? 'var(--soft)' : n >= limit ? 'var(--warning)' : 'var(--primary)' }} />
      ))}
      {used > limit && (
        <span aria-hidden="true" className="absolute -top-1 -bottom-1 w-px bg-(--foreground) opacity-60"
          style={{ left: `calc(${(limit / total) * 100}% - 1px)` }} />
      )}
    </span>
  );
}

function Segment({ stage, now }: { stage: Stage; now: number }) {
  const n = stage.items.length;
  const grow = stage.slots ? Math.max(stage.slots.used, stage.slots.limit) : n;
  const empty = n === 0 && !stage.slots;
  return (
    <Tooltip>
      <TooltipTrigger render={
        <div className={`group flex min-w-max cursor-default flex-col justify-center gap-1.5 self-stretch ${stage.apart ? 'ml-2.5' : ''}`}
          style={{ flex: `${grow} 1 0px` }} />
      }>
        <span className={`flex items-baseline gap-1 whitespace-nowrap pr-2 text-xs leading-none ${empty ? 'opacity-55' : ''}`}>
          <span className="text-[13px] font-semibold tabular-nums" style={stage.tone ? { color: stage.tone } : undefined}>
            {stage.slots ? <>{stage.slots.used}<span className="text-[11px] font-normal text-(--muted-foreground)">/{stage.slots.limit}</span></> : n}
          </span>
          <span className="text-(--muted-foreground) group-hover:text-(--foreground)">{stage.label}</span>
        </span>
        {stage.slots
          ? <Slots {...stage.slots} />
          : <span className="h-1.5 w-full rounded-full transition-[filter] group-hover:brightness-110"
              style={{
                background: empty ? 'var(--soft)' : stage.color, opacity: empty ? 0.6 : 1,
                boxShadow: stage.loud && !empty ? '0 0 0 2px color-mix(in srgb, var(--warning) 28%, transparent)' : undefined,
              }} />}
      </TooltipTrigger>
      <TooltipPopup side="bottom" align="start"><ItemList stage={stage} now={now} /></TooltipPopup>
    </Tooltip>
  );
}

function Spend({ stats }: { stats: StatsData }) {
  const top = stats.data.items
    .map((i) => ({ i, cost: statsOf(i)?.costUsd ?? 0 }))
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3);
  return (
    <Tooltip>
      <TooltipTrigger render={<div className="flex shrink-0 cursor-default flex-col items-end justify-center gap-1 self-stretch border-l border-(--border) pl-3.5" />}>
        <span className="text-[13px] font-medium leading-none tabular-nums text-(--foreground)">{formatUsd(stats.spend)}</span>
        <span className="text-[11px] leading-none text-(--muted-foreground)">agent spend</span>
      </TooltipTrigger>
      <TooltipPopup side="bottom" align="end">
        <div className="flex w-56 flex-col gap-1.5 py-0.5">
          <span className="text-(--muted-foreground)">Agent cost on open and recent items</span>
          {top.map(({ i, cost }) => (
            <span key={i.id} className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate">{i.title}</span>
              <span className="shrink-0 tabular-nums">{formatUsd(cost)}</span>
            </span>
          ))}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

export function StatsB({ stats }: { stats: StatsData }) {
  const items = stats.data.items;
  const building = items.filter((i) => i.status === 'In progress');
  const moving = items.filter((i) => i.status === 'Shaping' || i.status === 'Ready' || i.status === 'Review');
  const over = stats.building > stats.buildLimit;
  const free = stats.buildLimit - stats.building;
  const stages: (Stage | null)[] = [
    { key: 'list', label: 'List', glyph: 'List', items: stats.list, color: 'color-mix(in srgb, var(--muted-foreground) 35%, transparent)', note: 'Not yet queued' },
    { key: 'queued', label: 'Queued', glyph: 'Queued', items: stats.queued, color: 'var(--st-idle)', note: 'Next for an agent' },
    {
      key: 'building', label: 'Building', glyph: 'In progress', items: building, color: 'var(--primary)',
      note: over ? `${stats.building - stats.buildLimit} over the limit` : free ? `${plural(free, 'slot')} free` : 'At the limit',
      tone: over ? 'var(--warning-foreground)' : undefined, slots: { used: stats.building, limit: stats.buildLimit },
    },
    moving.length ? { key: 'moving', label: 'Shaping & review', glyph: 'Review', items: moving, color: 'var(--sub)', note: 'Agents on it' } : null,
    {
      key: 'needs', label: 'Needs you', glyph: 'Needs you', items: stats.needsYou, color: 'var(--warning)', note: 'Only you can move these',
      tone: stats.needsYou.length ? 'var(--warning-foreground)' : undefined, loud: true,
    },
    { key: 'shipped', label: 'Shipped', glyph: 'Done', items: stats.done, color: 'var(--success)', note: 'Last 7 days', apart: true, when: (i) => i.closedAt ?? i.updatedAt },
  ];
  return (
    <div className="flex h-12 items-stretch gap-3.5 overflow-x-auto rounded-xl border border-(--border) bg-(--card) px-3.5 py-2">
      <div className="flex min-w-0 flex-1 gap-0.5" aria-label="Work by stage">
        {stages.filter((s): s is Stage => s !== null).map((s) => <Segment key={s.key} stage={s} now={stats.now} />)}
      </div>
      <Spend stats={stats} />
    </div>
  );
}
