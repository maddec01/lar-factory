// PROTOTYPE, throwaway. What every sidebar variant gets from the control room.

import type { BoardData, Item } from '@mux-factory/shared';

/** The item open in the details dialog, and how to open another. */
export type Pick = { id: string | null; set: (id: string) => void };

export interface SidebarProps {
  data: BoardData;
  now: number;
  /** The search field's text, trimmed and lower-cased; empty when not searching. */
  query: string;
  /** The platform the main view is scoped to, or null for the whole factory. */
  platform: string | null;
  onScope: (platform: string | null) => void;
  pick: Pick;
}

export const matches = (item: Item, q: string, ref: string) => !q || `${item.title} ${ref}`.toLowerCase().includes(q);
