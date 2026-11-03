// The agent figures on one line, shared by the stage rows and the dock's rows, and the columns a dock row keeps so
// they line up across dossiers: its title and chips, what's next, part bar, part count, then its figures and
// repositories, which drop when the dock is narrow.

import { duration, formatTokens, formatUsd, itemTotal } from '@lar-factory/shared';
import type { BoardData, Item, ItemStats } from '@lar-factory/shared';
import { hasFigures, useLastKnown } from '../items/item-parts.tsx';
import { statsOf } from './stage-track.tsx';

export const DOCK_COLUMNS = 'grid-cols-[minmax(0,1fr)_minmax(0,11rem)_4rem_3rem] @4xl:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_5rem_2.5rem_8rem_5rem]';

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
