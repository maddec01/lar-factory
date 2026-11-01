// The item dialog's details for one item, its description's save and its markdown export. Sample mode serves the
// details from a file beside the board's fixture and saves and exports nothing; otherwise the work record gives its own
// text and progress, and the provider of its ticket reads and writes the ticket's. Its labels go through the tracker's
// label operations, one name at a time, so no write replaces the ticket's whole set.

import { readFileSync } from 'node:fs';
import { userInfo, homedir } from 'node:os';
import { join } from 'node:path';
import { onAzure, readTicketSpec, stripTrackerStructure, trackerCapabilities } from '@lar-factory/shared';
import type { DescriptionSave, Item, ItemComment, ItemCommentsPage, ItemDetails, LabelChange, RecordDetails, TrackerLabel, TrackerLabels } from '@lar-factory/shared';
import { trackerLabels } from '@lar-factory/shared/tracker-labels';
import { WorkRecordError, type WorkRecords } from '@lar-factory/work-records';
import { activeSpecState, editSpec, refreshSpecs, resolveSpecEdit, syncSpecs, type SpecSyncOptions } from '@lar-factory/work-records/spec-sync';
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
  /** The labels the repository of the item's ticket offers, without the managed ones. */
  labels(item: Item): Promise<{ labels: TrackerLabel[] } | Refused>;
  /** Adds a label to the item's ticket or removes it; null when the tracker took it, else the refusal to show. */
  changeLabels(item: Item, change: LabelChange): Promise<Refused | null>;
  exportMarkdown: ExportItem;
  specAction?(item: Item, generation: number, action: 'retry' | 'accept' | 'reject'): Promise<Refused | null>;
}

export interface RecordsDeps {
  /** The work records the board shows; null when they couldn't be opened. */
  records: WorkRecords | null;
  /** Where an export writes; the user's Downloads folder by default. */
  exportFolder?: string;
  specSync?: SpecSyncOptions;
  /** The label operations of a repository; tests stand in for the tracker. */
  labelsOf?: (repo: string) => TrackerLabels;
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
    labels: async () => ({ status: 403, error: 'Sample mode reads no labels.' }),
    changeLabels: async () => ({ status: 403, error: 'Changing labels is disabled in sample mode.' }),
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
  { records, exportFolder = join(homedir(), 'Downloads'), specSync, labelsOf = trackerLabels }: RecordsDeps = { records: null }): ItemDetailsReader {
  if (sampleFile) return fromFile(sampleFile);
  const azure = (item: Item) => Boolean(item.repo && onAzure(item.repo));
  return {
    async details(work) {
      let record = records ? recordDetails(records, work.id) : undefined;
      if (record && records) {
        await refreshSpecs(records, { ...specSync, workId: work.id });
        record = recordDetails(records, work.id);
      }
      const item = ticketOf(work);
      const read = !item ? NO_DETAILS : azure(item) ? await readAzureItemDetails(item) : await readGithubItemDetails(item);
      const state = record && records ? activeSpecState(records, work.id, specSync) : null;
      if (state) {
        const details = 'error' in read ? NO_DETAILS : read;
        const parsed = readTicketSpec(stripTrackerStructure(details.body));
        return { ...details, body: record!.body, format: 'markdown', record,
          spec: { generation: state.generation, pending: state.pending !== null, error: state.error, warning: state.warning,
            original: parsed.original ?? state.original ?? (!state.active ? state.base?.body ?? details.body : null), originalFormat: azure(work) ? 'html' : 'markdown',
            held: state.held ? { title: state.held.title, body: readTicketSpec(stripTrackerStructure(state.held.body)).spec } : null } };
      }
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
      if (records && recordDetails(records, work.id)) {
        try { if (await editSpec(records, work.id, body, userInfo().username, specSync)) return null; }
        catch (error) { return { status: 409, error: (error as Error).message }; }
      }
      if (!azure(item)) return saveGithubDescription(item, body);
      if (!bodyField || revision === undefined) return { status: 400, error: 'Send the field and revision the work item\'s details gave.' };
      return saveAzureDescription(item, { body, bodyField, revision });
    },
    async labels(work) {
      const item = ticketOf(work);
      if (!item) return NO_TICKET;
      try { return { labels: (await labelsOf(item.repo).list()).filter(({ name }) => !trackerCapabilities(item.repo).isManaged(name)) }; }
      catch (error) { return { status: 502, error: `Could not read the ${trackerCapabilities(item.repo).noun}s. ${(error as Error).message}` }; }
    },
    async changeLabels(work, { label, action }) {
      const item = ticketOf(work);
      if (!item) return NO_TICKET;
      // Azure joins a ticket's tags into one field, so a name holding its separator would write the tags after it too.
      const separated = trackerCapabilities(item.repo).ticketNameProblem(label);
      if (separated) return { status: 422, error: separated };
      const labels = labelsOf(item.repo);
      try {
        await (action === 'add' ? labels.addToTicket(item.number, [label]) : labels.removeFromTicket(item.number, [label]));
        return null;
      } catch (error) { return { status: 502, error: `Could not change the ${trackerCapabilities(item.repo).noun}s on #${item.number}. ${(error as Error).message}` }; }
    },
    async specAction(work, generation, action) {
      if (!records) return { status: 409, error: 'The board has no work records.' };
      try {
        if (action === 'retry') {
          await refreshSpecs(records, { ...specSync, workId: work.id });
          await syncSpecs(records, { ...specSync, workId: work.id });
        }
        else await resolveSpecEdit(records, work.id, generation, action, userInfo().username, specSync);
        return null;
      } catch (error) { return { status: 409, error: (error as Error).message }; }
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
