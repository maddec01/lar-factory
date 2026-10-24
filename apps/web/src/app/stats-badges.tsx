// An item's own stats and, when sub-issues on the board add figures, its total: on cards and Done rows.

import { itemTotal } from '../../../server/src/model.ts';
import type { BoardData, Item, ItemStats } from '../../../server/src/model.ts';
import { UNREADABLE, figures, statsTitle, totalTitle } from '../../../server/src/board-view.ts';

/**
 * Agent time, wall time, total tokens and API cost, `Σ 3h 20m · wall 1h 10m · 12.4M · $41.20`;
 * nothing when no thread worked on the item. Screen readers hear "agent time" for Σ.
 */
export function StatsBadge({ item }: { item: Item }) {
  const stats = item.stats;
  if (!stats) return null;
  if (stats === 'unavailable') return <span className="stats" title={UNREADABLE}>stats unavailable</span>;
  return <span className="stats" title={statsTitle(stats)}><span aria-hidden="true">Σ</span><span className="sr-only">agent time</span> {figures(stats)}</span>;
}

/** The total beside the item stats, when sub-issues on the board add figures to them. */
export function shownTotal(item: Item, data: BoardData): ItemStats | 'unavailable' | null {
  // The stats badge already says the item's own stats are unavailable.
  return item.stats === 'unavailable' ? null : itemTotal(item, data.items);
}

/** The item total, `total 4h 10m · wall 2h 0m · 14.4M · $63.20`; never Σ, which means agent time. */
export function TotalBadge({ total }: { total: ItemStats | 'unavailable' | null }) {
  if (!total) return null;
  if (total === 'unavailable') return <span className="stats total" title={UNREADABLE}>total unavailable</span>;
  return <span className="stats total" title={totalTitle(total)}>total {figures(total)}</span>;
}
