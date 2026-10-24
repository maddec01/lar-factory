// PROTOTYPE, throwaway. Small item pieces the variants arrange differently: the status track, slices,
// pull requests with checks, stats, and the one action each status asks of you.

import { Check, ExternalLink, GitPullRequest, Play } from 'lucide-react';
import { HINTS, STATUSES, checkState, duration, formatTokens, formatUsd, prLabel, ref } from '@mux-factory/shared';
import type { Item, Status } from '@mux-factory/shared';
import { Button, STATUS_COLOR } from './chrome.tsx';

/** Ten steps as a track; the past filled, the current one in its colour and named. */
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

export function SliceBar({ item }: { item: Item }) {
  if (!item.slices.length) return null;
  return (
    <ol className="m-0 flex list-none gap-[2px] p-0">
      {item.slices.map((s) => (
        <li key={s.number} title={`#${s.number} ${s.title}`} className={`h-1 flex-1 rounded-full ${s.progress === 'active' ? 'proto-pulse' : ''}`}
          style={{ background: s.progress === 'done' ? 'var(--st-done)' : s.progress === 'active' ? 'var(--st-now)' : s.progress === 'blocked' ? 'var(--st-review)' : 'var(--soft)' }} />
      ))}
    </ol>
  );
}

export function SliceList({ item }: { item: Item }) {
  return (
    <ul className="m-0 grid list-none gap-0.5 p-0">
      {item.slices.map((s) => (
        <li key={s.number} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-(--row-hover)">
          <span className="grid size-4 place-items-center rounded-full border-[1.5px]"
            style={{ borderColor: s.progress === 'done' ? 'var(--st-done)' : s.progress === 'active' ? 'var(--st-now)' : s.progress === 'blocked' ? 'var(--st-review)' : 'var(--input)', background: s.progress === 'done' ? 'var(--st-done)' : 'transparent' }}>
            {s.progress === 'done' && <Check className="size-2.5 text-white" strokeWidth={3} />}
            {s.progress === 'active' && <span className="proto-pulse size-1.5 rounded-full bg-(--st-now)" />}
          </span>
          <span className="text-(--muted-foreground) tabular-nums">#{s.number}</span>
          <span className={`min-w-0 flex-1 truncate ${s.progress === 'done' ? 'text-(--muted-foreground) line-through' : s.progress === 'active' ? 'font-medium' : ''}`}>{s.title}</span>
          <span className="text-[11px] text-(--muted-foreground)">{s.progress}</span>
        </li>
      ))}
    </ul>
  );
}

export function ChecksDot({ item }: { item: Item }) {
  const states = item.linkedPrs.map((p) => checkState(p.checks));
  const color = states.includes('failed') ? 'var(--error)' : states.includes('running') ? 'var(--warning)' : states.includes('passed') ? 'var(--st-done)' : null;
  if (!color) return null;
  return <span className="inline-flex items-center gap-1 text-[11px] text-(--muted-foreground)"><GitPullRequest className="size-3" /><span className="size-1.5 rounded-full" style={{ background: color }} /></span>;
}

export function PrList({ item }: { item: Item }) {
  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {item.linkedPrs.map((pr) => {
        const state = checkState(pr.checks);
        return (
          <li key={pr.number} className="flex items-center gap-2 rounded-lg border border-(--border) bg-(--card) px-3 py-2">
            <GitPullRequest className="size-4 text-(--st-done)" />
            <a href={pr.url} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate font-medium hover:underline">{prLabel(pr)}</a>
            {state && <span className="inline-flex items-center gap-1.5 text-xs text-(--muted-foreground)"><span className="size-2 rounded-full" style={{ background: state === 'failed' ? 'var(--error)' : state === 'running' ? 'var(--warning)' : 'var(--st-done)' }} />checks {state}</span>}
          </li>
        );
      })}
    </ul>
  );
}

export function statsOf(item: Item) {
  return item.stats && item.stats !== 'unavailable' ? item.stats : null;
}

export function StatsGrid({ item }: { item: Item }) {
  const s = statsOf(item);
  if (!s) return <p className="m-0 text-xs text-(--muted-foreground)">No T3 thread has worked on this yet.</p>;
  const cells = [['Agent time', duration(s.agentMs)], ['Wall time', s.wallMs ? duration(s.wallMs) : '–'], ['Tokens', formatTokens(s.tokens)], ['Cost', s.costUsd !== undefined ? formatUsd(s.costUsd) : '–']];
  return (
    <dl className="m-0 grid grid-cols-4 gap-px overflow-hidden rounded-lg border border-(--border) bg-(--border)">
      {cells.map(([k, v]) => <div key={k} className="bg-(--card) px-3 py-2"><dt className="text-[11px] text-(--muted-foreground)">{k}</dt><dd className="m-0 text-sm font-medium tabular-nums">{v}</dd></div>)}
    </dl>
  );
}

/** The one thing each status asks of you, as a button label; stubs, nothing is written. */
export function primaryAction(item: Item): string | null {
  switch (item.status) {
    case 'Needs you': return 'Answer in T3';
    case 'Verify': return 'Verify build';
    case 'Ready to merge': return 'Merge PR';
    case 'Queued': return 'Start';
    case 'List': return 'Queue';
    case 'In progress': case 'Review': case 'Shaping': return 'Open thread';
    default: return null;
  }
}

export function ActionButtons({ item, small }: { item: Item; small?: boolean }) {
  const label = primaryAction(item);
  return (
    <span className="inline-flex items-center gap-1.5">
      {item.url && <a href={item.url} target="_blank" rel="noopener"><Button small={small}><ExternalLink /> GitHub</Button></a>}
      {label && <Button primary small={small}>{label === 'Start' && <Play />}{label}</Button>}
    </span>
  );
}

export const hint = (item: Item) => HINTS[item.status];
export const refText = (item: Item) => ref(item);
