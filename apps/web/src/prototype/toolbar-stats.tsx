// PROTOTYPE, throwaway. The control room's five stats as T3-style ghost toolbar buttons in the 52 px header, always
// for the whole factory whatever repo the sidebar scopes to. Each icon is the status's own glyph in its own colour,
// and each opens a popover listing the items behind the number; picking one opens its details. The row reads its
// own width through a container query: labels go first, then Spend, Queued and Shipped, so it never overflows.

import type { ReactNode } from 'react';
import { CircleDollarSign } from 'lucide-react';
import { boardSections, formatUsd, platformOf, plural, shortAgo } from '@mux-factory/shared';
import type { BoardData, Item, Status } from '@mux-factory/shared';
import { Button } from '@mux-factory/ui/button';
import { Popover, PopoverClose, PopoverPopup, PopoverTrigger } from '@mux-factory/ui/popover';
import { Tooltip, TooltipPopup, TooltipTrigger } from '@mux-factory/ui/tooltip';
import { noDrag, platformColor, STATUS_COLOR, StatusGlyph } from './chrome.tsx';
import { ItemTitle, statsOf } from './item-bits.tsx';

const BUILD_LIMIT = 2;
const YOURS: Status[] = ['Needs you', 'Verify', 'Ready to merge'];

type Open = (id: string) => void;

/** One toolbar counter: a ghost button with a glyph, a tabular count and a label that shows only when there's room. */
function Counter({ icon, value, label, hint, hideBelow, children }: {
  icon: ReactNode; value: ReactNode; label: string; hint: string; hideBelow?: string; children: ReactNode;
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
          {icon}
          <span className="font-medium tabular-nums text-(--foreground)">{value}</span>
          <span className="hidden font-normal @min-[560px]:inline">{label}</span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">{hint}</TooltipPopup>
      </Tooltip>
      <PopoverPopup side="bottom" align="end" padding="none" className="w-96">{children}</PopoverPopup>
    </Popover>
  );
}

function PopHead({ icon, title, sub }: { icon: ReactNode; title: string; sub?: ReactNode }) {
  return (
    <div className="flex h-10 items-center gap-2 border-b border-(--border) px-3">
      {icon}
      <span className="flex-1 text-[13px] font-medium">{title}</span>
      {sub !== undefined && <span className="text-xs text-(--muted-foreground) tabular-nums">{sub}</span>}
    </div>
  );
}

function PopFoot({ children }: { children: ReactNode }) {
  return <div className="border-t border-(--border) px-3 py-2 text-xs text-(--muted-foreground)">{children}</div>;
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="m-0 px-3 py-6 text-center text-xs text-(--muted-foreground)">{children}</p>;
}

/** One item: its status glyph, title, its number and title, then its repo's dot and age (or a trailing figure). Picking it opens its details. */
function Row({ item, data, now, open, trailing }: { item: Item; data: BoardData; now: number; open: Open; trailing?: ReactNode }) {
  return (
    <li>
      <PopoverClose render={<button type="button" onClick={() => open(item.id)} />}
        className="flex h-8 w-full cursor-default items-center gap-2 rounded-md px-2 text-left text-[13px] text-(--foreground) outline-none hover:bg-(--accent) focus-visible:bg-(--accent)">
        <StatusGlyph status={item.status} />
        <span className="min-w-0 flex-1 truncate"><ItemTitle item={item} /></span>
        <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-(--muted-foreground) tabular-nums">
          {trailing ?? <>
            <span className="size-1.5 rounded-full" style={{ background: platformColor(platformOf(item, data.repos)) }} />
            <span className="w-7 text-right">{shortAgo(item.closedAt ?? item.updatedAt, now)}</span>
          </>}
        </span>
      </PopoverClose>
    </li>
  );
}

function List({ items, max = 8, children }: { items: Item[]; max?: number; children: (i: Item) => ReactNode }) {
  return (
    <ul className="m-0 grid list-none gap-px p-1">
      {items.slice(0, max).map(children)}
      {items.length > max && <li className="px-2 py-1.5 text-xs text-(--muted-foreground)">and {items.length - max} more</li>}
    </ul>
  );
}

/** The in-flight slots: one bar per slot, filled for each running build, extra builds past the limit after a gap. */
function Slots({ used, limit }: { used: number; limit: number }) {
  const bar = (n: number, on: boolean) => (
    <span key={n} className="h-1.5 w-3 rounded-full" style={{ background: on ? STATUS_COLOR['In progress'] : 'var(--border)' }} />
  );
  return (
    <span className="inline-flex items-center gap-[3px]">
      {Array.from({ length: limit }, (_, n) => bar(n, n < used))}
      {used > limit && <span className="ml-1 inline-flex gap-[3px]">{Array.from({ length: used - limit }, (_, n) => bar(limit + n, true))}</span>}
    </span>
  );
}

const byNewest = (a: Item, b: Item) => (b.closedAt ?? b.updatedAt).localeCompare(a.closedAt ?? a.updatedAt);

export function ToolbarStats({ data, now, open }: { data: BoardData; now: number; open: Open }) {
  const s = boardSections(data, now);
  const building = data.items.filter((i) => i.status === 'In progress');
  const costs = data.items
    .map((item) => ({ item, cost: statsOf(item)?.costUsd ?? 0 }))
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost);
  const spend = costs.reduce((t, c) => t + c.cost, 0);
  const free = BUILD_LIMIT - building.length;
  const row = (i: Item, trailing?: ReactNode) => <Row key={i.id} item={i} data={data} now={now} open={open} trailing={trailing} />;
  const glyph = (status: Status) => <StatusGlyph status={status} />;

  return (
    <div className="@container flex w-full min-w-0 justify-end">
      <div className="flex min-w-0 items-center gap-0.5 overflow-hidden whitespace-nowrap">
        <Counter label="need you" value={s.needsYou.length} icon={glyph('Needs you')}
          hint={s.needsYou.length ? `${plural(s.needsYou.length, 'item')} only you can move` : 'Nothing waits on you'}>
          <PopHead icon={glyph('Needs you')} title="Needs you" sub={s.needsYou.length} />
          {s.needsYou.length ? (
            <div className="grid gap-1 py-1">
              {YOURS.map((status) => {
                const items = s.needsYou.filter((i) => i.status === status);
                return items.length > 0 && (
                  <section key={status}>
                    <h3 className="m-0 px-3 pt-1.5 pb-0.5 text-[11px] font-medium text-(--muted-foreground)">{status} <span className="tabular-nums">{items.length}</span></h3>
                    <List items={items}>{(i) => row(i)}</List>
                  </section>
                );
              })}
            </div>
          ) : <Empty>Desk clear. The line runs without you.</Empty>}
        </Counter>

        <Counter label="building" icon={glyph('In progress')}
          value={<>{building.length}<span className="font-normal text-(--muted-foreground)">/{BUILD_LIMIT}</span></>}
          hint={free > 0 ? `${plural(free, 'slot')} free of ${BUILD_LIMIT}` : free === 0 ? 'At the in-flight limit' : `${-free} over the in-flight limit`}>
          <PopHead icon={glyph('In progress')} title="Building"
            sub={<span className="inline-flex items-center gap-2"><Slots used={building.length} limit={BUILD_LIMIT} />{building.length}/{BUILD_LIMIT}</span>} />
          {building.length ? <List items={building}>{(i) => row(i)}</List> : <Empty>Nothing building right now.</Empty>}
          <PopFoot>{free > 0 ? `${plural(free, 'slot')} free: the next queued item can start.` : 'No free slot: queued items wait for one.'}</PopFoot>
        </Counter>

        <Counter label="queued" value={s.queued.length} icon={glyph('Queued')} hideBelow="hidden @min-[300px]:inline-flex"
          hint={`${s.queued.length ? `${plural(s.queued.length, 'item')} ready to build` : 'Nothing queued'}, ${s.list.length} more in List`}>
          <PopHead icon={glyph('Queued')} title="Queued" sub={s.queued.length} />
          {s.queued.length ? <List items={s.queued}>{(i) => row(i)}</List> : <Empty>Nothing queued.</Empty>}
          <PopFoot>{s.list.length ? `${plural(s.list.length, 'item')} more in List, not yet queued.` : 'List is empty.'}</PopFoot>
        </Counter>

        <Counter label="shipped" value={s.done.length} icon={glyph('Done')} hideBelow="hidden @min-[180px]:inline-flex" hint="Done in the last 7 days">
          <PopHead icon={glyph('Done')} title="Shipped" sub="last 7 days" />
          {s.done.length ? <List items={[...s.done].sort(byNewest)}>{(i) => row(i)}</List> : <Empty>Nothing shipped this week.</Empty>}
        </Counter>

        <span aria-hidden="true" className="mx-1 hidden h-4 w-px shrink-0 bg-(--border) @min-[380px]:block" />

        <Counter label="spend" value={formatUsd(spend)} hideBelow="hidden @min-[380px]:inline-flex" hint="Agent cost on open and recent items"
          icon={<CircleDollarSign className="size-3.5 shrink-0" strokeWidth={2.25} />}>
          <PopHead icon={<CircleDollarSign className="size-3.5 shrink-0 text-(--muted-foreground)" strokeWidth={2.25} />} title="Agent spend" sub={formatUsd(spend)} />
          {costs.length
            ? <List items={costs.map((c) => c.item)} max={5}>{(i) => row(i, <span className="font-medium text-(--foreground)">{formatUsd(statsOf(i)?.costUsd ?? 0)}</span>)}</List>
            : <Empty>No priced agent work yet.</Empty>}
          {costs.length > 5 && <PopFoot>Top 5 of {plural(costs.length, 'priced item')}.</PopFoot>}
        </Counter>
      </div>
    </div>
  );
}
