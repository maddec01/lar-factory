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

/** Reports which item sources a read is reading: each source starts and finishes under its name, in whatever order its reads end. */
export interface ReadProgress {
  started(name: string): void;
  finished(name: string): void;
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

/**
 * How fast a merged read keeps each source: a source holding an item `active` says is due every `activeMs`, any other
 * every `idleMs`, ACTIVE_READ_MS and IDLE_READ_MS when absent, and every source is idle while `slow` holds, as when a
 * provider's quota runs low. A source whose change check sees every edit keeps only the items `polled` says at
 * `activeMs`, as no check sees a PR's checks finish.
 */
export interface ReadPace {
  now: number;
  active(item: Item): boolean;
  polled(item: Item): boolean;
  activeMs?: number;
  idleMs?: number;
  slow?: boolean;
}

/** The error every item source gives a Done write: Done is never stored, and an item is Done once it closes. */
export const DONE_REFUSED = 'Could not set Done. The board never stores Done. Close the item to make it Done.';

/** Every write returns the error to show, or null when the provider accepted it. */
export interface ItemSource {
  /** What a read reports for this source; absent for a source its repositories name, as the merged source then does. */
  name?: string;
  /**
   * Reads the source's items, reporting to `progress` for each source it reads on its way, if it merges several. A
   * merged source given `pace` reads only the sources due at its pace, and lists the others' items from their last read.
   */
  read(progress?: ReadProgress, pace?: ReadPace): Promise<ItemsRead>;
  /**
   * Reads these items alone afresh, as the source lists them, with their slices, PRs and checks; an item the source
   * no longer lists is left out. Absent on a source that reads only whole.
   */
  readSome?(items: Item[]): Promise<Item[]>;
  /**
   * What changed since `since`, in ms since the epoch, by a check that costs no quota while nothing did: the URLs of
   * the changed issues and PRs; null when the check can't tell which, so the whole source reads. Absent on a source
   * with no such check.
   */
  changes?(since: number): Promise<string[] | null>;
  /** Whether `changes` names every edit to an item: its state, labels, slices and PRs. */
  seesEdits?: boolean;
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
