// The agent figures on one line, shared by the stage rows and the dock's rows, and the columns they keep so they line up
// down the whole board: glyph, source and repository, kind, title, state and the 10rem action slot, 12px apart, with 12px
// outside them. The title's column ends in the pull request, or a dock row's part bar and count, and the figures, which
// drop on a narrow row. A stage row gives the room of what it lacks to its title, keeping the x of what it has; the state
// and action never move.

import { duration, formatTokens, formatUsd, itemMembers, itemTotal } from '@lar-factory/shared';
import type { BoardData, Item, ItemStats } from '@lar-factory/shared';
import { useBoardStore } from '../board/board-store.ts';
import { hasFigures, INCOMPLETE_TOTAL, useLastKnown, usageLoading } from '../items/item-parts.tsx';
import { Loader } from '../loading/loader.tsx';
import { statsOf } from './stage-track.tsx';

/** A stage row's action slot follows these, in the row's own 10rem and gap; a dock row has it as its last column. */
export const ROW_COLUMNS = 'grid-cols-[1.5rem_8.5rem_6.75rem_minmax(0,1fr)_16rem]';
export const DOCK_COLUMNS = 'grid-cols-[1.5rem_8.5rem_6.75rem_minmax(0,1fr)_16rem_10rem]';
/** The ends of the title's column. */
export const LINK_COLUMN = 'w-28 min-w-0 shrink-0';
export const FIGURES_COLUMN = 'hidden w-38 min-w-0 shrink-0 @6xl:grid';
/** What a row's action slot holds, centred and against its right edge; `.row-action` makes its buttons 32 px. */
export const ROW_ACTION = 'row-action flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right text-[11px] text-(--muted-foreground)';

/** The agent figures: a Dossier's total (parent plus parts), else the item's own; null when there are none. A total with no figures to show is empty and incomplete. */
export const figuresOf = (item: Item, data: BoardData, total?: boolean): ItemStats | null => {
  const sum = total ? itemTotal(item, data.items) : null;
  return sum === null ? statsOf(item) : sum === 'unavailable' ? { agentMs: 0, tokens: 0, incomplete: true } : sum;
};

/** The agent figures on one line, time · tokens · cost, from the same fields AgentCell reads; nothing when there are none. An incomplete total ends in a +, and its tooltip says why, as it does when they are the last ones seen. While usage loads, known figures stay with a spinner in the tokens' room, the tooltip giving them all, and none known yet give a spinner and its label. A `total` loads while any of its members does. */
export function Figures({ s, item, total }: { s: ItemStats | null; item: Item; total?: boolean }) {
  const lastKnown = useLastKnown(item);
  const data = useBoardStore((state) => state.data);
  const loading = usageLoading(item, data) || !!total && itemMembers(item, data.items).some((member) => usageLoading(member, data));
  if (!s || !hasFigures(s) && (loading || !s.incomplete)) return loading ? <Loader label="Loading usage" /> : <span />;
  const cost = s.costUsd !== undefined ? formatUsd(s.costUsd) : null;
  const all = hasFigures(s) ? [duration(s.agentMs), formatTokens(s.tokens), cost].filter(Boolean).join(' · ') : null;
  const text = all && loading ? [duration(s.agentMs), cost].filter(Boolean).join(' · ') : all;
  const title = s.frozen ? 'Agent time · tokens · cost, as it stood at merge' : [all && `Agent time · tokens · cost${loading ? `: ${all}` : ''}`, all && lastKnown, s.incomplete && INCOMPLETE_TOTAL, loading && UPDATING].filter(Boolean).join('. ');
  return (
    <span className="flex min-w-0 items-center justify-end gap-1 text-[11px] tabular-nums text-(--muted-foreground)" title={title}>
      {loading && <Loader title={UPDATING} />}
      {text && <span className="truncate">{text}</span>}
      {s.incomplete && (text
        ? <span className="-ml-1 shrink-0" data-partial>+<span className="sr-only"> partial</span></span>
        : <span className="shrink-0">Usage incomplete</span>)}
    </span>
  );
}

const UPDATING = 'Updating usage';
