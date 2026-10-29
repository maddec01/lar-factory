// The Line's two-line rows, shared by the Dossiers and the In flight rows so their columns sit at the same x: line 1's
// lead and line 2's indent, line 2's fixed columns, and the agent figures on one line.

import { duration, formatTokens, formatUsd, itemTotal } from '@lar-factory/shared';
import type { BoardData, Item, ItemStats } from '@lar-factory/shared';
import { statsOf } from './stage-track.tsx';

/** Line 1's lead and line 2's indent. */
export const HEAD_A1 = 'grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 gap-y-1 px-2 py-1.5';
/** Line 2's columns, the same fixed widths in every row: bar, count, what's next, agent figures, and repositories,
 *  which drop below 1024 px. "What's next" takes the rest, so it shrinks first. */
export const LINE2_A1 = 'grid-cols-[18rem_5.5rem_minmax(0,1fr)_9.5rem] lg:grid-cols-[18rem_5.5rem_minmax(0,1fr)_9.5rem_9rem]';

/** The agent figures: a Dossier's total (parent plus parts), else the item's own; null when there are none. */
export const figuresOf = (item: Item, data: BoardData, total?: boolean): ItemStats | null => {
  const sum = total ? itemTotal(item, data.items) : null;
  return sum === null ? statsOf(item) : sum === 'unavailable' ? null : sum;
};

/** The agent figures on one line, time · tokens · cost, from the same fields AgentCell reads; nothing when there are none. */
export function Figures({ s }: { s: ItemStats | null }) {
  if (!s) return <span />;
  const text = [duration(s.agentMs), formatTokens(s.tokens), s.costUsd !== undefined ? formatUsd(s.costUsd) : null].filter(Boolean).join(' · ');
  return <span className="truncate text-right text-[11px] tabular-nums text-(--muted-foreground)" title={s.frozen ? 'Agent time · tokens · cost, as it stood at merge' : 'Agent time · tokens · cost'}>{text}</span>;
}
