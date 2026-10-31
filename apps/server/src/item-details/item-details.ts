// The item dialog's details for one item, its description's save and its markdown export. Sample mode serves the
// details from a file beside the board's fixture and saves and exports nothing; otherwise the work record gives its own
// text and progress, and the provider of its ticket reads and writes the ticket's.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { onAzure } from '@lar-factory/shared';
import type { DescriptionSave, Item, ItemComment, ItemCommentsPage, ItemDetails, RecordDetails } from '@lar-factory/shared';
import { WorkRecordError, type WorkRecords } from '@lar-factory/work-records';
import { exportMarkdown } from '@lar-factory/work-records/export';
import type { Refused } from '../config/editable-repository.ts';
import { readAzureItemDetails, readAzureOlderComments } from '../azure/azure-details.ts';
import { saveAzureDescription } from '../azure/azure-writes.ts';
import { readGithubItemDetails, readGithubOlderComments, saveGithubDescription } from '../github/github-details.ts';

/** Reads one item's details, or says why it can't. */
type ReadItemDetails = (item: Item) => Promise<ItemDetails | Refused>;
/** Reads the 10 comments older than `before`, a cursor its details or an earlier page gave, or says why it can't. */
type ReadOlderComments = (item: Item, before: string) => Promise<ItemCommentsPage | Refused>;

/** Saves the item's description as markdown; null when the provider took it, else the refusal to show. */
type SaveDescription = (item: Item, save: Omit<DescriptionSave, 'itemId'>) => Promise<Refused | null>;

/** Writes the record's markdown as `lar-work export` does, answering the paths it wrote or why it can't. */
type ExportItem = (item: Item) => Promise<{ paths: string[] } | Refused>;

export interface ItemDetailsReader {
  details: ReadItemDetails;
  olderComments: ReadOlderComments;
  saveDescription: SaveDescription;
  exportMarkdown: ExportItem;
}

export interface RecordsDeps {
  /** The work records the board shows; null when they couldn't be opened. */
  records: WorkRecords | null;
  /** Where an export writes; the user's Downloads folder by default. */
  exportFolder?: string;
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
    exportMarkdown: async () => ({ status: 403, error: 'Exporting is disabled in sample mode.' }),
  };
}

/** A concept holds a map, a decision its text, and every other kind a brief. */
const bodyKindOf = (kind: string): RecordDetails['bodyKind'] => (kind === 'concept' ? 'map' : kind === 'decision' ? 'decision' : 'brief');

/** The record's own text and progress, or undefined when it has none, such as an item read before its record was made. */
function recordDetails(records: WorkRecords, workId: string): RecordDetails | undefined {
  let record;
  try { record = records.read(workId); }
  catch (error) {
    if (error instanceof WorkRecordError && error.code === 'not-found') return undefined;
    throw error;
  }
  const bodyKind = bodyKindOf(record.kind);
  return {
    bodyKind,
    body: records.body(workId, bodyKind) ?? '',
    context: records.initialContext(workId),
    buildPhase: record.buildPhase,
    reviewRounds: records.reviewRounds(workId).map(({ round, recordedAt, reviewers }) => ({ round, recordedAt,
      reviewers: reviewers.map(({ axis, verdict, findings }) => ({ axis, verdict, findings: findings.length, open: findings.filter((f) => f.disposition === 'open').length })) })),
  };
}

const NO_TICKET: Refused = { status: 409, error: 'This work has no ticket the board has read.' };

/**
 * The reader for the board: the file in sample mode, else the provider of the ticket `ticketOf` finds for a board item,
 * which reads and writes it by its node id. Work with no ticket has no details.
 */
export function createItemDetails(sampleFile: string | null, ticketOf: (item: Item) => Item | undefined,
  { records, exportFolder = join(homedir(), 'Downloads') }: RecordsDeps = { records: null }): ItemDetailsReader {
  if (sampleFile) return fromFile(sampleFile);
  const azure = (item: Item) => Boolean(item.repo && onAzure(item.repo));
  return {
    async details(work) {
      const record = records ? recordDetails(records, work.id) : undefined;
      const item = ticketOf(work);
      const read = !item ? NO_DETAILS : azure(item) ? await readAzureItemDetails(item) : await readGithubItemDetails(item);
      return record && !('error' in read) ? { ...read, record } : read;
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
    async exportMarkdown(work) {
      if (!records) return { status: 409, error: 'The board has no work records to export.' };
      try { return { paths: exportMarkdown(records, work.id, exportFolder) }; }
      catch (error) {
        // A record with nothing written or a file already in the folder refuses the export; the record stays as it was.
        if (error instanceof WorkRecordError) return { status: 409, error: error.message };
        throw error;
      }
    },
  };
}
