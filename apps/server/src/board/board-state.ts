// The board data the server serves, with the items this board just changed or
// abandoned laid over what GitHub last reported, and the pages it pushes changes to.

import type { BoardData, Item } from '@lar-factory/shared';

export interface BoardState {
  /** The board data as served now. */
  snapshot(): BoardData;
  /** Sets fields of the board data; push sends them to the pages. */
  update(fields: Partial<BoardData>): void;
  /** The revision a read starting now runs against; pass it to applyRead. */
  revision(): number;
  /**
   * Takes in the items a read started at `since` got from GitHub, keeping each change
   * this board made until GitHub reports it. Abandoned items stay hidden until their provider reports a newer open version.
   * Only a read that `afresh` says read a change's source counts toward giving up on it.
   */
  applyRead(items: Item[], since: number, enrich: (items: Item[]) => Item[], afresh?: (item: Item) => boolean): void;
  /** Whether the board shows a change to the item that GitHub hasn't reported yet. */
  changing(itemId: string): boolean;
  /** Shows a change at once and keeps it through refreshes until GitHub reports it. */
  showChanged(item: Item): void;
  /** Drops an abandoned item at once while the provider catches up. */
  remove(itemId: string): void;
  /** Whether this board still hides the abandoned item. */
  removed(itemId: string): boolean;
  find(itemId: string): Item | undefined;
  /** Sends the board data to every page, after a read or a change made through the board. */
  push(): void;
  /** Calls `send` on each push until the returned function is called. */
  subscribe(send: (data: BoardData) => void): () => void;
}

/** Whether two copies of an item carry the same statuses, so a pick shows until a read drops the others. */
const sameStatuses = (a: Item, b: Item) => a.statuses.join() === b.statuses.join();

export function createBoardState(initial: BoardData): BoardState {
  const state = initial;
  let revision = 0;
  /** Items this board just created or moved, shown as changed until GitHub reports the change. */
  const recentItems = new Map<string, { item: Item; revision: number; unconfirmedReads: number }>();
  /** Abandoned items stay hidden while reads still report their old version. */
  const abandoned = new Map<string, { item: Item | undefined; revision: number }>();
  const pages = new Set<(data: BoardData) => void>();

  const push = () => {
    for (const send of pages) send(state);
  };

  return {
    snapshot: () => state,
    update: (fields) => void Object.assign(state, fields),
    revision: () => revision,
    applyRead(items, since, enrich, afresh = () => true) {
      for (const [id, recent] of recentItems) {
        if (since < recent.revision || !afresh(recent.item)) continue;
        // Give GitHub three reads of the item's source to expose the change, then trust what it reports.
        const reported = items.some((i) => i.id === id && i.status === recent.item.status && sameStatuses(i, recent.item));
        if (reported || ++recent.unconfirmedReads >= 3) recentItems.delete(id);
      }
      for (const [id, removed] of abandoned) {
        if (!removed.item || removed.item.number === null || since < removed.revision || !afresh(removed.item)) continue;
        const reported = items.find((i) => i.id === id);
        if (reported?.state === 'open' && reported.updatedAt > removed.item.updatedAt) abandoned.delete(id);
      }
      state.items = enrich([...items.filter((i) => !recentItems.has(i.id) && !abandoned.has(i.id)), ...[...recentItems.values()].map((r) => r.item)]);
    },
    showChanged(item) {
      if (abandoned.has(item.id)) return;
      recentItems.set(item.id, { item, revision: ++revision, unconfirmedReads: 0 });
      state.items = [...state.items.filter((i) => i.id !== item.id), item];
      push();
    },
    remove(itemId) {
      abandoned.set(itemId, { item: state.items.find((i) => i.id === itemId), revision: ++revision });
      recentItems.delete(itemId);
      state.items = state.items.filter((i) => i.id !== itemId);
      push();
    },
    changing: (itemId) => recentItems.has(itemId),
    removed: (itemId) => abandoned.has(itemId),
    find: (itemId) => state.items.find((i) => i.id === itemId),
    push,
    subscribe(send) {
      pages.add(send);
      return () => pages.delete(send);
    },
  };
}
