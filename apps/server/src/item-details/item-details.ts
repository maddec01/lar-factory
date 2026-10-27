// The item dialog's details for one item. Sample mode serves them from a file beside the board's fixture; otherwise
// each provider reads its own, which the GitHub and Azure DevOps readers fill in.

import { readFileSync } from 'node:fs';
import { onAzure } from '@lar-factory/shared';
import type { Item, ItemDetails } from '@lar-factory/shared';
import type { Refused } from '../config/edit-config.ts';

/** Reads one item's details, or says why it can't. */
export type ReadItemDetails = (item: Item) => Promise<ItemDetails | Refused>;

const NO_DETAILS: ItemDetails = { body: '', format: 'markdown', author: null, assignees: [], createdAt: null, subTickets: [], comments: [], hasOlderComments: false, olderCursor: null };

const notAvailable: ReadItemDetails = async () => ({ status: 501, error: 'Item details are not available yet.' });

/** The details file next to the board fixture: `sample.json` has `sample-details.json`. */
export const detailsFileFor = (fixture: string): string => fixture.replace(/\.json$/, '-details.json');

/** Reads the details file, which maps an item's id to its details; an item it doesn't name has none. */
function fromFile(file: string): ReadItemDetails {
  let all: Record<string, ItemDetails> | undefined;
  return async (item) => {
    all ??= JSON.parse(readFileSync(file, 'utf8')) as Record<string, ItemDetails>;
    return all[item.id] ?? NO_DETAILS;
  };
}

/** The reader for the board: the file in sample mode, else the item's provider. */
export function createItemDetails(sampleFile: string | null): ReadItemDetails {
  if (sampleFile) return fromFile(sampleFile);
  const github = notAvailable;
  const azure = notAvailable;
  return (item) => (item.repo && onAzure(item.repo) ? azure : github)(item);
}
