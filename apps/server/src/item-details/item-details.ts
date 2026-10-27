// The item dialog's details for one item. Sample mode serves them from a file beside the board's fixture; otherwise
// each provider reads its own.

import { readFileSync } from 'node:fs';
import { onAzure } from '@lar-factory/shared';
import type { Item, ItemComment, ItemCommentsPage, ItemDetails } from '@lar-factory/shared';
import type { Refused } from '../config/edit-config.ts';
import { readAzureItemDetails, readAzureOlderComments } from '../azure/azure-details.ts';
import { readGithubItemDetails, readGithubOlderComments } from '../github/github-details.ts';

/** Reads one item's details, or says why it can't. */
type ReadItemDetails = (item: Item) => Promise<ItemDetails | Refused>;
/** Reads the 10 comments older than `before`, a cursor its details or an earlier page gave, or says why it can't. */
type ReadOlderComments = (item: Item, before: string) => Promise<ItemCommentsPage | Refused>;

export interface ItemDetailsReader {
  details: ReadItemDetails;
  olderComments: ReadOlderComments;
}

/** Comments per older page; GitHub and Azure DevOps both answer 10. */
const PAGE = 10;

const NO_DETAILS: ItemDetails = { body: '', format: 'markdown', author: null, assignees: [], createdAt: null, subTickets: [], comments: [], hasOlderComments: false, olderCursor: null };

/** The details file next to the board fixture: `sample.json` has `sample-details.json`. */
export const detailsFileFor = (fixture: string): string => fixture.replace(/\.json$/, '-details.json');

/**
 * Reads the details file, which maps an item's id to its details; an item it doesn't name has none. Its `$older` key
 * maps an item's id to the comments older than its details' (newest first), which are paged by how many were served.
 */
function fromFile(file: string): ItemDetailsReader {
  let all: (Record<string, ItemDetails> & { $older?: Record<string, ItemComment[]> }) | undefined;
  const read = () => all ??= JSON.parse(readFileSync(file, 'utf8')) as NonNullable<typeof all>;
  return {
    details: async (item) => read()[item.id] ?? NO_DETAILS,
    olderComments: async (item, before) => {
      const older = read().$older?.[item.id] ?? [];
      const from = Number(before) || 0;
      return { comments: older.slice(from, from + PAGE), olderCursor: from + PAGE < older.length ? String(from + PAGE) : null };
    },
  };
}

/** The reader for the board: the file in sample mode, else the item's provider. */
export function createItemDetails(sampleFile: string | null): ItemDetailsReader {
  if (sampleFile) return fromFile(sampleFile);
  const azure = (item: Item) => Boolean(item.repo && onAzure(item.repo));
  return {
    details: (item) => (azure(item) ? readAzureItemDetails(item) : readGithubItemDetails(item)),
    olderComments: (item, before) => (azure(item) ? readAzureOlderComments(item, before) : readGithubOlderComments(item, before)),
  };
}
