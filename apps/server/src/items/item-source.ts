// The item source interface: where the board server reads its items and writes their changes.
// Each adapter lives with its provider's code, such as the GitHub Project's in github/github-project.ts.

import type { CreationProgress, CreationResult, IssueRef, Item, ItemDraft, Status } from '@lar-factory/shared';

/** One read of an item source: its title, for the board's header, and its items. */
export interface ItemsRead {
  title: string;
  items: Item[];
}

/** The error every item source gives a Done write: Done is never stored, and an item is Done once it closes. */
export const DONE_REFUSED = 'Could not set Done. The board never stores Done. Close the item to make it Done.';

/** Every write returns the error to show, or null when the provider accepted it. */
export interface ItemSource {
  read(): Promise<ItemsRead>;
  setStatus(item: Item, status: Status): Promise<string | null>;
  /** Why a status write on an item, or on a parent that isn't on the board, would be refused before it runs; null when it may run. */
  statusRefusal(item: Item | IssueRef): string | null;
  addLabel(item: Item, label: string): Promise<string | null>;
  /** Add item: creates the item a draft describes, resuming from `progress` after a failed try. */
  create(draft: ItemDraft, progress: CreationProgress): Promise<CreationResult>;
  /** Sets the status of a child's parent that isn't on the board, adding it to the item source first. */
  setParentStatus(parent: IssueRef, status: Status): Promise<string | null>;
  abandon(item: Item): Promise<string | null>;
  /** The Item.id now of an item a record saved under an id from before Item.id was the content's node id; undefined when none is. */
  renamedId?(savedId: string): string | undefined;
}
