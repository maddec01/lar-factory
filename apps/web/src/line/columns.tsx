// The agent figures on one line, shared by the stage rows and the dock's rows, and the columns they keep so they line up
// down the whole board: glyph, source and repository, kind, title, state, pull request and figures, which drop on a
// narrow row. A stage row's action follows in the row's own 10rem. A dock row has its part bar in the pull request's
// column, and its count and other repositories in the action's.

import { duration, formatTokens, formatUsd, itemTotal } from '@lar-factory/shared';
import type { BoardData, Item, ItemStats } from '@lar-factory/shared';
import { hasFigures, useLastKnown } from '../items/item-parts.tsx';
import { statsOf } from './stage-track.tsx';

export const ROW_COLUMNS = 'grid-cols-[1.5rem_8.5rem_6.75rem_minmax(0,1.4fr)_minmax(13rem,1fr)_7rem] @6xl:grid-cols-[1.5rem_8.5rem_6.75rem_minmax(0,1.4fr)_minmax(13rem,1fr)_7rem_9.5rem]';
export const DOCK_COLUMNS = 'grid-cols-[1.5rem_8.5rem_6.75rem_minmax(0,1.4fr)_minmax(13rem,1fr)_7rem_3rem_6.5rem] @6xl:grid-cols-[1.5rem_8.5rem_6.75rem_minmax(0,1.4fr)_minmax(13rem,1fr)_7rem_9.5rem_3rem_6.5rem]';

/** The agent figures: a Dossier's total (parent plus parts), else the item's own; null when there are none. */
export const figuresOf = (item: Item, data: BoardData, total?: boolean): ItemStats | null => {
  const sum = total ? itemTotal(item, data.items) : null;
  return sum === null ? statsOf(item) : sum === 'unavailable' ? null : sum;
};

/** The agent figures on one line, time · tokens · cost, from the same fields AgentCell reads; nothing when there are none. Its tooltip says when they are the last ones seen. */
export function Figures({ s }: { s: ItemStats | null }) {
  const lastKnown = useLastKnown();
  if (!s || !hasFigures(s)) return <span />;
  const text = [duration(s.agentMs), formatTokens(s.tokens), s.costUsd !== undefined ? formatUsd(s.costUsd) : null].filter(Boolean).join(' · ');
  return <span className="truncate text-right text-[11px] tabular-nums text-(--muted-foreground)" title={s.frozen ? 'Agent time · tokens · cost, as it stood at merge' : `Agent time · tokens · cost${lastKnown ? `. ${lastKnown}` : ''}`}>{text}</span>;
}
