// PROTOTYPE, throwaway. What every stats variant gets: the control room's numbers, for the scope picked in the sidebar.

import type { BoardData, Item } from '@mux-factory/shared';

export interface StatsData {
  /** The board, already narrowed to the repo picked in the sidebar (or the whole factory). */
  data: BoardData;
  now: number;
  /** Items waiting on you: Needs you, Verify, Ready to merge. */
  needsYou: Item[];
  /** Items In progress, against the in-flight limit. */
  building: number;
  buildLimit: number;
  queued: Item[];
  /** Items in List, not yet queued. */
  list: Item[];
  /** Items done in the last 7 days. */
  done: Item[];
  /** Agent cost in USD on open and recent items. */
  spend: number;
}
