// PROTOTYPE, throwaway. Stats variant B: placeholder, a subagent fills this in.

import type { StatsData } from './stats-data.ts';

export const NAME = 'Placeholder';

export function StatsB({ stats }: { stats: StatsData }) {
  return <div className="rounded-xl border border-dashed border-(--input) p-3 text-(--muted-foreground)">Variant B: {stats.needsYou.length} need you</div>;
}
