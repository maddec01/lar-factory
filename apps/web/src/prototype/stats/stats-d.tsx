// PROTOTYPE, throwaway. Header stats variant D, "Toolbar counters": the five stats as T3-style ghost toolbar
// buttons in the 52 px header, icon plus count, right-aligned toward the header's buttons. Each opens a small
// popover that drills into the items behind the number (or, for Spend, the priciest items). The row reads its own
// width through a container query: labels go first, then Spend, Queued and Shipped, so it never overflows.

import type { ReactNode } from 'react';
import { Check, CircleDollarSign, CircleDot, Clock3, LoaderCircle } from 'lucide-react';
import { formatUsd, plural, shortAgo } from '@mux-factory/shared';
import type { Item } from '@mux-factory/shared';
import { Button } from '@mux-factory/ui/button';
import { Popover, PopoverPopup, PopoverTrigger } from '@mux-factory/ui/popover';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { noDrag, STATUS_COLOR, StatusGlyph } from '../chrome.tsx';
import { refText, statsOf } from '../item-bits.tsx';
import type { StatsData } from './stats-data.ts';

export const NAME = 'Toolbar counters';

/** One toolbar counter: a ghost button with an icon, a tabular count and a label that shows only when there's room. */
function Counter({ icon, value, label, hint, tone, hideBelow, children }: {
  icon: ReactNode; value: ReactNode; label: string; hint: string; tone?: string; hideBelow?: string; children: ReactNode;
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger render={
          <PopoverTrigger render={
            <Button variant="ghost" size="xs" aria-label={`${label}: ${hint}`}
              className={`${noDrag} gap-1.5 px-2 text-(--muted-foreground) hover:text-(--foreground) data-popup-open:bg-(--accent) data-popup-open:text-(--foreground) ${hideBelow ?? ''}`} />
          } />
        }>
          <span className="inline-flex shrink-0 items-center" style={tone ? { color: tone } : undefined}>{icon}</span>
          <span className="font-medium tabular-nums text-(--foreground)">{value}</span>
          <span className="hidden font-normal @min-[560px]:inline">{label}</span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">{hint}</TooltipPopup>
      </Tooltip>
      <PopoverPopup side="bottom" align="end" padding="none" className="w-80">{children}</PopoverPopup>
    </Popover>
  );
}

function PopHead({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-(--border) px-3 py-2.5">
      <span className="text-[13px] font-medium">{title}</span>
      {sub && <span className="text-xs text-(--muted-foreground) tabular-nums">{sub}</span>}
    </div>
  );
}

function PopFoot({ children }: { children: ReactNode }) {
  return <div className="border-t border-(--border) px-3 py-2 text-xs text-(--muted-foreground)">{children}</div>;
}

/** The drill-in list: status glyph, title, ref and age (or a trailing figure), each row linking to GitHub. */
function ItemList({ items, now, empty, trailing, max = 6 }: { items: Item[]; now: number; empty: string; trailing?: (i: Item) => ReactNode; max?: number }) {
  if (!items.length) return <p className="m-0 px-3 py-4 text-center text-xs text-(--muted-foreground)">{empty}</p>;
  return (
    <ul className="m-0 grid list-none gap-px p-1">
      {items.slice(0, max).map((i) => (
        <li key={i.id}>
          <a href={i.url ?? undefined} target="_blank" rel="noopener"
            className="flex h-8 items-center gap-2 rounded-md px-2 text-[13px] text-(--foreground) no-underline hover:bg-(--accent)">
            <StatusGlyph status={i.status} />
            <span className="min-w-0 flex-1 truncate">{i.title}</span>
            <span className="shrink-0 text-[11px] text-(--muted-foreground) tabular-nums">{trailing ? trailing(i) : <>{refText(i)} · {shortAgo(i.closedAt ?? i.updatedAt, now)}</>}</span>
          </a>
        </li>
      ))}
      {items.length > max && <li className="px-2 py-1.5 text-xs text-(--muted-foreground)">and {items.length - max} more</li>}
    </ul>
  );
}

/** The in-flight slots as small bars, filled for each running build. */
function Slots({ used, limit }: { used: number; limit: number }) {
  return (
    <span className="inline-flex gap-[3px]">
      {Array.from({ length: Math.max(limit, used) }, (_, n) => (
        <span key={n} className="h-1.5 w-3 rounded-full"
          style={n < used ? { background: n >= limit ? 'var(--warning)' : 'var(--primary)' } : { background: 'var(--border)' }} />
      ))}
    </span>
  );
}

const byNewest = (a: Item, b: Item) => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt);

export function StatsD({ stats }: { stats: StatsData }) {
  const { data, now, needsYou, building, buildLimit, queued, list, done, spend } = stats;
  const inProgress = data.items.filter((i) => i.status === 'In progress');
  const costs = data.items
    .map((item) => ({ item, cost: statsOf(item)?.costUsd ?? 0 }))
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost);
  const costOf = new Map(costs.map((c) => [c.item.id, c.cost]));
  const atLimit = building >= buildLimit;
  const idle = 'var(--muted-foreground)';

  return (
    <div className="@container flex w-full min-w-0 justify-end">
      <div className="flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap">
        <Counter label="need you" value={needsYou.length}
          hint={needsYou.length ? `${plural(needsYou.length, 'item')} only you can move` : 'Nothing waits on you'}
          tone={needsYou.length ? STATUS_COLOR['Needs you'] : idle}
          icon={<CircleDot className={`size-3.5 ${needsYou.length ? 'proto-pulse' : ''}`} strokeWidth={2.25} />}>
          <PopHead title="Needs you" sub={needsYou.length || undefined} />
          <ItemList items={needsYou} now={now} empty="Desk clear. The line runs without you." />
        </Counter>

        <Counter label="building" value={<>{building}<span className="font-normal text-(--muted-foreground)">/{buildLimit}</span></>}
          hint={atLimit ? 'At the in-flight limit' : `${plural(buildLimit - building, 'slot')} free of ${buildLimit}`}
          tone={building ? (building > buildLimit ? 'var(--warning)' : STATUS_COLOR['In progress']) : idle}
          icon={<LoaderCircle className={`size-3.5 ${building ? 'animate-spin [animation-duration:2.4s]' : ''}`} strokeWidth={2.25} />}>
          <PopHead title="Building" sub={<span className="inline-flex items-center gap-2"><Slots used={building} limit={buildLimit} />{building}/{buildLimit}</span>} />
          <ItemList items={inProgress} now={now} empty="Nothing building right now." />
          <PopFoot>{atLimit ? 'At the limit: queued items wait for a slot.' : `${plural(buildLimit - building, 'slot')} free; the next queued item can start.`}</PopFoot>
        </Counter>

        <Counter label="queued" value={queued.length} hideBelow="hidden @min-[300px]:inline-flex"
          hint={`${queued.length ? `${plural(queued.length, 'item')} ready to build` : 'Nothing queued'}, ${list.length} more in List`}
          tone={queued.length ? STATUS_COLOR.Queued : idle}
          icon={<Clock3 className="size-3.5" strokeWidth={2.25} />}>
          <PopHead title="Queued" sub={queued.length || undefined} />
          <ItemList items={queued} now={now} empty="Nothing queued." />
          <PopFoot>{list.length ? `${plural(list.length, 'item')} more in List, not yet queued` : 'List is empty'}</PopFoot>
        </Counter>

        <Counter label="shipped" value={done.length} hideBelow="hidden @min-[180px]:inline-flex"
          hint="Done in the last 7 days"
          tone={done.length ? STATUS_COLOR.Done : idle}
          icon={<Check className="size-3.5" strokeWidth={2.5} />}>
          <PopHead title="Shipped" sub="last 7 days" />
          <ItemList items={[...done].sort(byNewest)} now={now} empty="Nothing shipped this week." />
        </Counter>

        <span aria-hidden="true" className="mx-1 hidden h-4 w-px shrink-0 bg-(--border) @min-[380px]:block" />

        <Counter label="spend" value={formatUsd(spend)} hideBelow="hidden @min-[380px]:inline-flex"
          hint="Agent cost on open and recent items" tone={idle}
          icon={<CircleDollarSign className="size-3.5" strokeWidth={2} />}>
          <PopHead title="Agent spend" sub={formatUsd(spend)} />
          <ItemList items={costs.map((c) => c.item)} now={now} max={5} empty="No priced agent work yet."
            trailing={(i) => <span className="font-medium text-(--foreground)">{formatUsd(costOf.get(i.id) ?? 0)}</span>} />
          {costs.length > 0 && <PopFoot>Top {Math.min(5, costs.length)} of {plural(costs.length, 'priced item')}</PopFoot>}
        </Counter>
      </div>
    </div>
  );
}
