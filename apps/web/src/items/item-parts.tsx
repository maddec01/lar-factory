// The bits every view draws for an item: its platform badge, kind pill, label pills, blocked-by badge and title link,
// and the item dialog's status track, slices, pull requests with checks, and agent work.
// The pills are T3's Badge; the board's CSS adds the coloured dot.

import { Check, GitPullRequest } from 'lucide-react';
import { STATUSES, UNREADABLE, checkState, duration, formatTokens, formatUsd, kindLabel, kindOf, plural, prLabel, ref, slug } from '@mux-factory/shared';
import type { Item, SliceProgress, Status } from '@mux-factory/shared';
import { Badge } from '@mux-factory/ui/badge';
import { STATUS_COLOR } from './status-glyph.tsx';

export function PlatformBadge({ platform }: { platform: string }) {
  return <Badge variant="outline" className={`plat plat-${slug(platform)}`}>{platform}</Badge>;
}

/** The control room's platform badge: smaller than PlatformBadge, with a medium label. */
export function PlatformTag({ platform }: { platform: string }) {
  return <Badge variant="outline" size="sm" className={`plat plat-${slug(platform)} gap-1.5 font-medium`}>{platform}</Badge>;
}

export function KindPill({ item }: { item: Item }) {
  return <Badge variant="outline" className={`kind kind-${kindOf(item)}`}>{kindLabel(item)}</Badge>;
}

export function BlockedBy({ count }: { count: number }) {
  return <Badge variant="error" className="blocked-by" title={`Blocked by ${plural(count, 'issue')}`}>blocked by {count}</Badge>;
}

export function TitleLink({ item, className = 'title' }: { item: Item; className?: string }) {
  const text = <><span className="ref">{ref(item)}</span> {item.title}</>;
  return item.url
    ? <a className={className} href={item.url} target="_blank" rel="noopener">{text}</a>
    : <span className={className}>{text}</span>;
}

/** One pill per GitHub label, kind included; a kind label keeps its colour. Always rendered, so it pushes a row's buttons to the end. */
export function LabelPills({ item }: { item: Item }) {
  return <span className="labels">{item.labels.map((l) => <Badge variant="outline" className={`label kind-${slug(l)}`} key={l}>{l}</Badge>)}</span>;
}

/** An item's title with its issue number before it, muted, the way the board lists every item. */
export function ItemTitle({ item }: { item: Item }) {
  return <><span className="font-normal text-(--muted-foreground) tabular-nums">{ref(item)}</span> {item.title}</>;
}

/** Ten steps as a track; the past filled, the current one in its colour and, with `labels`, named. */
export function StepTrack({ status, labels }: { status: Status; labels?: boolean }) {
  const at = STATUSES.indexOf(status);
  return (
    <div className="grid gap-1.5">
      <ol className="m-0 flex list-none gap-[3px] p-0">
        {STATUSES.map((s, i) => (
          <li key={s} title={s} className="h-1.5 flex-1 rounded-full"
            style={{ background: i < at ? 'color-mix(in srgb, var(--foreground) 28%, transparent)' : i === at ? STATUS_COLOR[s] : 'var(--soft)' }} />
        ))}
      </ol>
      {labels && (
        <ol className="m-0 flex list-none gap-[3px] p-0 text-[10px] text-(--muted-foreground)">
          {STATUSES.map((s, i) => <li key={s} className={`flex-1 truncate ${i === at ? 'font-semibold text-(--foreground)' : ''}`}>{s}</li>)}
        </ol>
      )}
    </div>
  );
}

const SLICE_COLOR: Record<SliceProgress, string> = { done: 'var(--st-done)', active: 'var(--st-now)', blocked: 'var(--st-review)', waiting: 'var(--input)' };

export function SliceList({ item }: { item: Item }) {
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0">
      {item.slices.map((s) => (
        <li key={s.number} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-(--soft)">
          <span className="grid size-4 place-items-center rounded-full border-[1.5px]"
            style={{ borderColor: SLICE_COLOR[s.progress], background: s.progress === 'done' ? 'var(--st-done)' : 'transparent' }}>
            {s.progress === 'done' && <Check className="size-2.5 text-white" strokeWidth={3} />}
            {s.progress === 'active' && <span className="status-pulse size-1.5 rounded-full bg-(--st-now)" />}
          </span>
          <span className="text-(--muted-foreground) tabular-nums">#{s.number}</span>
          <span className={`min-w-0 flex-1 truncate ${s.progress === 'done' ? 'text-(--muted-foreground) line-through' : s.progress === 'active' ? 'font-medium' : ''}`}>{s.title}</span>
          <span className="text-[11px] text-(--muted-foreground)">{s.progress}</span>
        </li>
      ))}
    </ul>
  );
}

const CHECKS_COLOR = { failed: 'var(--error)', running: 'var(--warning)', passed: 'var(--st-done)' } as const;

export function PrList({ item }: { item: Item }) {
  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {item.linkedPrs.map((pr) => {
        const state = checkState(pr.checks);
        return (
          <li key={pr.number} className="flex items-center gap-2 rounded-lg border border-(--border) bg-(--card) px-3 py-2">
            <GitPullRequest className="size-4 text-(--st-done)" />
            <a href={pr.url} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate font-medium hover:underline">{prLabel(pr)}</a>
            {state && <span className="inline-flex items-center gap-1.5 text-xs text-(--muted-foreground)"><span className="size-2 rounded-full" style={{ background: CHECKS_COLOR[state] }} />checks {state}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** Agent time, wall time, tokens and cost, one cell each; a line instead when no thread worked on the item or T3's database can't be read. */
export function StatsGrid({ item }: { item: Item }) {
  const s = item.stats;
  if (!s || s === 'unavailable') return <p className="m-0 text-xs text-(--muted-foreground)">{s ? UNREADABLE : 'No T3 thread has worked on this yet.'}</p>;
  const cells = [['Agent time', duration(s.agentMs)], ['Wall time', s.wallMs ? duration(s.wallMs) : '–'], ['Tokens', formatTokens(s.tokens)], ['Cost', s.costUsd !== undefined ? formatUsd(s.costUsd) : '–']];
  return (
    <dl className="m-0 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-(--border) bg-(--border)">
      {cells.map(([k, v]) => <div key={k} className="bg-(--card) px-3 py-2"><dt className="text-[11px] text-(--muted-foreground)">{k}</dt><dd className="m-0 text-sm font-medium tabular-nums">{v}</dd></div>)}
    </dl>
  );
}
