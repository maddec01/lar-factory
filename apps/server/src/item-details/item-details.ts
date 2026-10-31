// The item dialog's details for one item, and its description's save. Sample mode serves the details from a file beside
// the board's fixture and saves nothing; otherwise each provider reads and writes its own.

import { readFileSync } from 'node:fs';
import { onAzure } from '@lar-factory/shared';
import type { DescriptionSave, Item, ItemComment, ItemCommentsPage, ItemDetails } from '@lar-factory/shared';
import type { Refused } from '../config/edit-config.ts';
import { readAzureItemDetails, readAzureOlderComments } from '../azure/azure-details.ts';
import { saveAzureDescription } from '../azure/azure-writes.ts';
import { readGithubItemDetails, readGithubOlderComments, saveGithubDescription } from '../github/github-details.ts';

/** Reads one item's details, or says why it can't. */
type ReadItemDetails = (item: Item) => Promise<ItemDetails | Refused>;
/** Reads the 10 comments older than `before`, a cursor its details or an earlier page gave, or says why it can't. */
type ReadOlderComments = (item: Item, before: string) => Promise<ItemCommentsPage | Refused>;

/** Saves the item's description as markdown; null when the provider took it, else the refusal to show. */
type SaveDescription = (item: Item, save: Omit<DescriptionSave, 'itemId'>) => Promise<Refused | null>;

export interface ItemDetailsReader {
  details: ReadItemDetails;
  olderComments: ReadOlderComments;
  saveDescription: SaveDescription;
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
    saveDescription: async () => ({ status: 403, error: 'Saving descriptions is disabled in sample mode.' }),
  };
}

const NO_TICKET: Refused = { status: 409, error: 'This work has no ticket the board has read.' };

/**
 * The reader for the board: the file in sample mode, else the provider of the ticket `ticketOf` finds for a board item,
 * which reads and writes it by its node id. Work with no ticket has no details.
 */
export function createItemDetails(sampleFile: string | null, ticketOf: (item: Item) => Item | undefined): ItemDetailsReader {
  if (sampleFile) return fromFile(sampleFile);
  const azure = (item: Item) => Boolean(item.repo && onAzure(item.repo));
  return {
    async details(work) {
      const item = ticketOf(work);
      if (!item) return NO_DETAILS;
      return azure(item) ? readAzureItemDetails(item) : readGithubItemDetails(item);
    },
    async olderComments(work, before) {
      const item = ticketOf(work);
      if (!item) return NO_TICKET;
      return azure(item) ? readAzureOlderComments(item, before) : readGithubOlderComments(item, before);
    },
    async saveDescription(work, { body, bodyField, revision }) {
      const item = ticketOf(work);
      if (!item) return NO_TICKET;
      if (!azure(item)) return saveGithubDescription(item, body);
      if (!bodyField || revision === undefined) return { status: 400, error: 'Send the field and revision the work item\'s details gave.' };
      return saveAzureDescription(item, { body, bodyField, revision });
    },
  };
}
