// PROTOTYPE, throwaway. Stats variant "Strip": the one-row bar the control room has now, kept to compare against.

import type { ReactNode } from 'react';
import { formatUsd } from '@mux-factory/shared';
import type { Item } from '@mux-factory/shared';
import type { StatsData } from './stats-data.ts';

/** One stat in the strip: the number, its label, an optional small chart, and the longer note on hover. */
function Stat({ label, value, note, tone, children }: { label: string; value: ReactNode; note: string; tone?: string; children?: ReactNode }) {
  return (
    <div title={note} className="flex min-w-0 flex-1 items-center gap-2 px-3.5">
      <span className="text-base font-semibold tabular-nums" style={tone ? { color: tone } : undefined}>{value}</span>
      <span className="truncate text-xs text-(--muted-foreground)">{label}</span>
      {children && <span className="ml-auto shrink-0">{children}</span>}
    </div>
  );
}

function Throughput({ done, now }: { done: Item[]; now: number }) {
  const days = Array.from({ length: 7 }, (_, d) => {
    const key = new Date(now - (6 - d) * 86_400_000).toDateString();
    return done.filter((i) => new Date(i.closedAt ?? i.updatedAt).toDateString() === key).length;
  });
  const max = Math.max(1, ...days);
  return (
    <div className="flex h-4 w-14 items-end gap-0.5">
      {days.map((n, i) => <div key={i} className="flex-1 rounded-[1px] bg-(--success)" style={{ height: `${Math.max(2, (n / max) * 16)}px`, opacity: n ? 1 : 0.2 }} />)}
    </div>
  );
}

export function StatsStrip({ stats }: { stats: StatsData }) {
  return (
  <div className="flex h-11 items-center divide-x divide-(--border) overflow-x-auto rounded-xl border border-(--border) bg-(--card)">
    <Stat label="Needs you" value={stats.needsYou.length} tone={stats.needsYou.length ? 'var(--warning-foreground)' : undefined} note="Only you can move these" />
    <Stat label="Building" value={<>{stats.building}<span className="text-xs font-normal text-(--muted-foreground)">/{stats.buildLimit}</span></>} note={stats.building >= stats.buildLimit ? 'At the in-flight limit' : 'Slots free'}>
      <span className="flex w-8 gap-0.5">{[0, 1].map((n) => <span key={n} className="h-1.5 flex-1 rounded-full" style={{ background: n < stats.building ? 'var(--primary)' : 'var(--soft)' }} />)}</span>
    </Stat>
    <Stat label="Queued" value={stats.queued.length} note={`${stats.list.length} more in List`} />
    <Stat label="Shipped" value={stats.done.length} note="Done in the last 7 days"><Throughput done={stats.done} now={stats.now} /></Stat>
    <Stat label="Spend" value={formatUsd(stats.spend)} note="Agent cost on open and recent items" />
  </div>
  );
}
