// PROTOTYPE, throwaway. Header stats variant E, "Activity capsule": one rounded capsule centred in the title bar, like
// Xcode's or Safari's activity view. The most urgent thing leads, the rest follow as glyph and number pairs, and a thin
// line along the bottom edge shows the week's shipped against open work. Click it for the full status sheet.

import type { ReactNode } from 'react';
import { Check, Clock3, LoaderCircle } from 'lucide-react';
import { formatUsd, platformOf, plural, shortAgo } from '@mux-factory/shared';
import type { Item } from '@mux-factory/shared';
import { Popover, PopoverPopup, PopoverTrigger } from '@mux-factory/ui/popover';
import { noDrag, platformColor, StatusGlyph } from '../chrome.tsx';
import { refText, statsOf } from '../item-bits.tsx';
import type { StatsData } from './stats-data.ts';

export const NAME = 'Activity capsule';

const DAY = 86_400_000;

/** Seven daily buckets of shipped items ending today, oldest first, with each day's initial. */
function shippedByDay(done: Item[], now: number) {
  return Array.from({ length: 7 }, (_, d) => {
    const day = new Date(now - (6 - d) * DAY);
    const key = day.toDateString();
    return { label: day.toLocaleDateString('en-US', { weekday: 'narrow' }), n: done.filter((i) => new Date(i.closedAt ?? i.updatedAt).toDateString() === key).length };
  });
}

/** Amber and breathing when something waits on you. */
function Beacon({ size = 'size-1.5' }: { size?: string }) {
  return (
    <span className={`relative flex shrink-0 ${size}`}>
      <span className="absolute inset-0 animate-ping rounded-full bg-(--warning) opacity-60" />
      <span className={`relative rounded-full bg-(--warning) ${size}`} />
    </span>
  );
}

const Rule = ({ className = '' }: { className?: string }) => <span aria-hidden="true" className={`h-3 w-px shrink-0 bg-(--border) ${className}`} />;

/** A glyph and a number inside the capsule. */
function Pair({ glyph, children, className = '' }: { glyph?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={`items-center gap-1 tabular-nums text-(--foreground) [&_svg]:size-3 [&_svg]:shrink-0 ${className || 'flex'}`}>
      {glyph}{children}
    </span>
  );
}

/** The in-flight slots as pips: filled for each running build, hollow for each free one. */
function Pips({ used, limit }: { used: number; limit: number }) {
  return (
    <span className="flex gap-1">
      {Array.from({ length: Math.max(limit, used) }, (_, n) => (
        <span key={n} className="size-2 rounded-full"
          style={n < used ? { background: n >= limit ? 'var(--warning)' : 'var(--st-now)' } : { boxShadow: 'inset 0 0 0 1px var(--muted-foreground)', opacity: 0.5 }} />
      ))}
    </span>
  );
}

/** Shipped against open work this week, as a two-tone line. */
function WeekLine({ shipped, open, className }: { shipped: number; open: number; className: string }) {
  const share = shipped + open ? shipped / (shipped + open) : 0;
  return (
    <span aria-hidden="true" className={`flex overflow-hidden bg-(--soft) ${className}`}>
      <span className="h-full bg-(--success) transition-[width] duration-500" style={{ width: `${share * 100}%` }} />
    </span>
  );
}

/** One block of the status sheet: a label, a big number and its note. */
function Block({ label, value, note, children, tone }: { label: string; value: ReactNode; note: ReactNode; children?: ReactNode; tone?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 px-4 py-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-(--muted-foreground)">{label}</span>
      <span className="flex items-end justify-between gap-2">
        <span className="text-xl font-semibold leading-none tracking-tight tabular-nums" style={tone ? { color: tone } : undefined}>{value}</span>
        {children}
      </span>
      <span className="truncate text-xs text-(--muted-foreground)">{note}</span>
    </div>
  );
}

function Sheet({ stats }: { stats: StatsData }) {
  const { data, needsYou, building, buildLimit, queued, list, done, spend, now } = stats;
  const days = shippedByDay(done, now);
  const max = Math.max(1, ...days.map((d) => d.n));
  const open = needsYou.length + building + queued.length;
  const lastShipped = done.map((i) => i.closedAt ?? i.updatedAt).sort().at(-1);
  const free = Math.max(0, buildLimit - building);
  const priciest = data.items
    .map((item) => ({ item, cost: statsOf(item)?.costUsd ?? 0 }))
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3);
  const top = priciest[0]?.cost ?? 1;

  return (
    <div className="flex flex-col text-[13px]">
      <div className="flex items-baseline justify-between gap-3 px-4 pt-3.5 pb-2.5">
        <span className="font-medium">Factory status</span>
        <span className="text-xs text-(--muted-foreground)">{data.fetchedAt ? `refreshed ${shortAgo(data.fetchedAt, now)}` : 'not refreshed yet'}</span>
      </div>

      <section className={`mx-2 rounded-lg px-2.5 py-2.5 ${needsYou.length ? 'bg-(--warning-surface)' : 'bg-(--soft)'}`}>
        <div className="flex items-center gap-2">
          {needsYou.length ? <Beacon size="size-2" /> : <Check className="size-3.5 text-(--success)" />}
          <span className={`font-medium ${needsYou.length ? 'text-(--warning-foreground)' : ''}`}>
            {needsYou.length ? `${needsYou.length} need${needsYou.length === 1 ? 's' : ''} you` : 'Nothing waits on you'}
          </span>
          {needsYou.length > 0 && <span className="text-xs text-(--muted-foreground)">only you can move {needsYou.length === 1 ? 'this' : 'these'}</span>}
        </div>
        {needsYou.length > 0 && (
          <ul className="m-0 mt-2 grid list-none gap-0.5 p-0">
            {needsYou.slice(0, 4).map((i) => (
              <li key={i.id} className="flex h-6 items-center gap-2 rounded-md px-1 hover:bg-(--soft)">
                <StatusGlyph status={i.status} className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                <span className="shrink-0 text-xs text-(--muted-foreground)">{i.status}</span>
                <span className="w-12 shrink-0 text-right font-mono text-[11px] text-(--muted-foreground)">{refText(i)}</span>
              </li>
            ))}
            {needsYou.length > 4 && <li className="px-1 text-xs text-(--muted-foreground)">and {needsYou.length - 4} more</li>}
          </ul>
        )}
      </section>

      <div className="mt-1 grid grid-cols-3 divide-x divide-(--border)">
        <Block label="Building" value={<>{building}<span className="text-sm font-normal text-(--muted-foreground)">/{buildLimit}</span></>}
          note={building >= buildLimit ? 'At the in-flight limit' : `${plural(free, 'slot')} free`}>
          <Pips used={building} limit={buildLimit} />
        </Block>
        <Block label="Queued" value={queued.length} note={list.length ? `${list.length} more in List` : 'List is empty'} />
        <Block label="Shipped" value={done.length} note={lastShipped ? `last ${shortAgo(lastShipped, now)}` : 'none in 7 days'}>
          <span className="flex items-end gap-[3px]" aria-hidden="true">
            {days.map((d, n) => (
              <span key={n} className="flex flex-col items-center gap-0.5">
                <span className="w-1.5 rounded-[1px]" style={{ height: `${3 + (d.n / max) * 17}px`, background: d.n ? 'var(--success)' : 'var(--soft)', opacity: n === 6 ? 1 : 0.75 }} />
                <span className="text-[8px] leading-none text-(--muted-foreground)">{d.label}</span>
              </span>
            ))}
          </span>
        </Block>
      </div>

      <div className="border-t border-(--border) px-4 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-medium uppercase tracking-wide text-(--muted-foreground)">Spend</span>
          <span className="text-sm font-semibold tabular-nums">{formatUsd(spend)} <span className="text-xs font-normal text-(--muted-foreground)">agent cost, open and recent</span></span>
        </div>
        {priciest.length > 0 && (
          <ul className="m-0 mt-2 grid list-none gap-1 p-0">
            {priciest.map(({ item, cost }) => (
              <li key={item.id} className="grid grid-cols-[minmax(0,1fr)_96px_56px] items-center gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="size-1.5 shrink-0 rounded-full" style={{ background: platformColor(platformOf(item, data.repos)) }} />
                  <span className="truncate">{item.title}</span>
                </span>
                <span className="h-1 overflow-hidden rounded-full bg-(--soft)">
                  <span className="block h-full rounded-full bg-(--muted-foreground) opacity-60" style={{ width: `${(cost / top) * 100}%` }} />
                </span>
                <span className="text-right tabular-nums text-(--muted-foreground)">{formatUsd(cost)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center gap-3 border-t border-(--border) bg-(--soft) px-4 py-2.5 text-xs text-(--muted-foreground)">
        <span className="shrink-0">This week</span>
        <WeekLine shipped={done.length} open={open} className="h-1 flex-1 rounded-full" />
        <span className="shrink-0 tabular-nums"><span className="text-(--success)">{done.length} shipped</span> · {open} open</span>
      </div>
    </div>
  );
}

export function StatsE({ stats }: { stats: StatsData }) {
  const { needsYou, building, buildLimit, queued, list, done, spend } = stats;
  const open = needsYou.length + building + queued.length;
  const summary = `${needsYou.length} need you, ${building} of ${buildLimit} building, ${queued.length} queued, ${done.length} shipped this week, ${formatUsd(spend)} spend`;

  return (
    // The container query lets the capsule shed its quieter pairs as the header narrows, never overflowing it.
    <div className="@container flex w-full min-w-0 justify-center">
      <Popover>
        <PopoverTrigger aria-label={`Factory status: ${summary}`}
          className={`group relative flex h-7 max-w-full min-w-0 cursor-default items-center gap-2.5 overflow-hidden rounded-lg border border-(--border) bg-(--soft) px-3 text-xs leading-none outline-none transition-colors hover:bg-(--accent) focus-visible:ring-2 focus-visible:ring-(--ring) data-popup-open:bg-(--accent) ${noDrag}`}>
          {needsYou.length ? (
            <span className="flex min-w-0 items-center gap-1.5 font-medium text-(--warning-foreground)">
              <Beacon />
              <span className="tabular-nums">{needsYou.length}</span>
              <span className="hidden truncate @[16rem]:inline">need{needsYou.length === 1 ? 's' : ''} you</span>
            </span>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5 text-(--muted-foreground)">
              <Check className="size-3 shrink-0 text-(--success)" />
              <span className="truncate">All clear</span>
            </span>
          )}
          <Rule />
          <Pair glyph={<LoaderCircle className={building ? 'animate-spin [animation-duration:2.4s]' : ''} style={{ color: 'var(--st-now)' }} />}>
            {building}<span className="text-(--muted-foreground)">/{buildLimit}</span>
          </Pair>
          <Rule className="hidden @[13rem]:block" />
          <Pair className="hidden @[13rem]:flex" glyph={<Clock3 className="text-(--muted-foreground)" />}>
            {queued.length}{list.length > 0 && <span className="text-(--muted-foreground) opacity-70">+{list.length}</span>}
          </Pair>
          <Rule className="hidden @[17rem]:block" />
          <Pair className="hidden @[17rem]:flex" glyph={<Check className="text-(--success)" />}>{done.length}</Pair>
          <Rule className="hidden @[22rem]:block" />
          <span className="hidden tabular-nums text-(--muted-foreground) @[22rem]:inline">{formatUsd(spend)}</span>
          <WeekLine shipped={done.length} open={open} className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] opacity-80" />
        </PopoverTrigger>
        <PopoverPopup padding="none" sideOffset={8} className="w-[min(34rem,calc(100vw-2rem))]">
          <Sheet stats={stats} />
        </PopoverPopup>
      </Popover>
    </div>
  );
}
