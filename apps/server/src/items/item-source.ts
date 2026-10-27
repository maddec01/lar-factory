// The item source interface: where the board server reads its items and writes their changes.
// Each adapter lives with its provider's code, such as the GitHub Project's in github/github-project.ts.

import type { CreationProgress, CreationResult, IssueRef, Item, ItemDraft, ItemSourceProblem, Status } from '@lar-factory/shared';

/** One read of an item source: its title, for the board's header, and its items. */
export interface ItemsRead {
  title: string;
  items: Item[];
  /** Each repository whose items the read left off, and why; absent when none. */
  problems?: ItemSourceProblem[];
}

/**
 * A read failure the user fixes outside the board, such as a logged-out az: the merged read leaves only this source's
 * repository off and shows the problem and its fix command, when one fixes it.
 */
export class ReadProblem extends Error {
  readonly fix?: string;
  constructor(message: string, fix?: string) {
    super(message);
    if (fix !== undefined) this.fix = fix;
  }
}

/** The error every item source gives a Done write: Done is never stored, and an item is Done once it closes. */
export const DONE_REFUSED = 'Could not set Done. The board never stores Done. Close the item to make it Done.';

/** Every write returns the error to show, or null when the provider accepted it. */
export interface ItemSource {
  read(): Promise<ItemsRead>;
  /** Sets the item's status, dropping every other status it carries. Callers check `statusRefusal` first. */
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
