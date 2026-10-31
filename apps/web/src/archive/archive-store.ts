// Settings › Archive's work: set aside, or finished and hidden by retention. The board data leaves it out, so Archive
// reads it from /api/archive when it opens and again after Restore or a retention save changes it.

import { create } from 'zustand';
import type { Item } from '@lar-factory/shared';

interface ArchiveState {
  /** Archive's work as the server answered last; null until Archive first reads it. */
  items: Item[] | null;
  /** Why the last read failed; null when it didn't. */
  problem: string | null;
  load: () => Promise<void>;
}

/** Counts reads, so only the latest one's answer shows. */
let reads = 0;

export const useArchiveStore = create<ArchiveState>()((set) => ({
  items: null,
  problem: null,
  async load() {
    const read = ++reads;
    try {
      const response = await fetch('/api/archive', { cache: 'no-store' });
      if (!response.ok) throw new Error(`the board answered ${response.status}`);
      const { items } = await response.json() as { items: Item[] };
      if (read === reads) set({ items, problem: null });
    } catch (err) {
      if (read === reads) set({ problem: `Can't read Archive: ${err instanceof Error ? err.message : String(err)}.` });
    }
  },
}));
