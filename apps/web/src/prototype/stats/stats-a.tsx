// PROTOTYPE, throwaway. Stats variant A: placeholder, a subagent fills this in.

import type { StatsData } from './stats-data.ts';

export const NAME = 'Placeholder';

export function StatsA({ stats }: { stats: StatsData }) {
  return <div className="rounded-xl border border-dashed border-(--input) p-3 text-(--muted-foreground)">Variant A: {stats.needsYou.length} need you</div>;
}
