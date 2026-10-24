// PROTOTYPE, throwaway. Stats variant C: placeholder, a subagent fills this in.

import type { StatsData } from './stats-data.ts';

export const NAME = 'Placeholder';

export function StatsC({ stats }: { stats: StatsData }) {
  return <div className="rounded-xl border border-dashed border-(--input) p-3 text-(--muted-foreground)">Variant C: {stats.needsYou.length} need you</div>;
}
