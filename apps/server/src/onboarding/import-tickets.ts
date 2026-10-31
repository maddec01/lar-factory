// Onboarding's one-time import, in its first step: the repository's open tickets carrying a status label or tag become
// work records with that Status, each with its ticket's text as initial context and its T3 threads matched once by
// the first-message rule. Nothing is written to the provider, and labels and tags stay where they are. A ticket already
// recorded keeps its record, so a repeated or resumed onboarding records what an earlier run left out and nothing twice.

import {
  STATUSES, isRecord, onAzure, statusLabel, type ImportableTicket, type Item, type RepositoryItemSource, type Status, type TicketImport,
  type TicketsImported,
} from '@lar-factory/shared';
import type { WorkRecord, WorkRecords } from '@lar-factory/work-records';
import { azureBoard } from '../azure/azure-board.ts';
import { isRepo } from '../config/repository-config.ts';
import { message } from '../github/github.ts';
import { repoIssues } from '../github/repo-issues.ts';
import type { ItemSource } from '../items/item-source.ts';
import { readT3Db, threadRows, type ThreadRows } from '../t3/t3-db.ts';
import { statsDbPath } from '../t3/t3-settings.ts';
import { namedThreads } from '../threads/item-threads.ts';

/** What the import reads: the repository's tickets through its item source, and T3's threads. */
export interface ImportReads {
  source(repo: string, itemSource: RepositoryItemSource): ItemSource;
  threads(): Promise<ThreadRows>;
}

const importReads: ImportReads = {
  source: (repo, itemSource) => (itemSource.kind === 'issues' ? repoIssues(repo) : azureBoard([repo], itemSource.team)),
  threads: async () => readT3Db(statsDbPath(), threadRows),
};

type Refused = { status: number; error: string };

const NO_RECORDS: Refused = { status: 409, error: 'The board has no work records to import into.' };

/** The body's repository and an item source of its provider, or null when either is missing or doesn't fit. */
function sourceOf({ repo, itemSource }: Record<string, unknown>): { repo: string; itemSource: RepositoryItemSource } | null {
  if (!isRepo(repo) || !isRecord(itemSource)) return null;
  if (itemSource.kind === 'issues') return onAzure(repo) ? null : { repo, itemSource: { kind: 'issues' } };
  if (itemSource.kind !== 'azure-board' || typeof itemSource.team !== 'string' || !onAzure(repo)) return null;
  return { repo, itemSource: { kind: 'azure-board', team: itemSource.team } };
}

const SOURCE = 'Choose the repository and its item source before importing its tickets.';

/** The repository's open tickets carrying a status, as the source reads them, each with the record holding it. */
async function candidates(repo: string, source: ItemSource, records: WorkRecords): Promise<ImportableTicket[]> {
  const items = (await source.read()).items.filter((item: Item) => item.state === 'open' && item.statuses.length > 0 && item.number > 0);
  const held = holders(repo, records);
  return items.map(({ number, title, url, statuses, untaggedFor }) => ({
    number, title, url: url ?? '', statuses, untagged: untaggedFor !== undefined, workId: held.get(ticketOf(repo, number).toLowerCase())?.workId ?? null,
  }));
}

const ticketOf = (repo: string, number: number) => `${repo}#${number}`;

/** The repository's records by ticket, `owner/name#12` in lower case. */
const holders = (repo: string, records: WorkRecords) =>
  new Map(records.list({ repository: repo }).flatMap((r): [string, WorkRecord][] => (r.ticket ? [[r.ticket.toLowerCase(), r]] : [])));

/** Onboarding's offer: the repository's open tickets carrying a status label or tag, or the status and problem. */
export async function importableTickets(input: Record<string, unknown>, records: WorkRecords | null, reads: ImportReads = importReads):
  Promise<{ tickets: ImportableTicket[] } | Refused> {
  const picked = sourceOf(input);
  if (!picked) return { status: 400, error: SOURCE };
  if (!records) return NO_RECORDS;
  try { return { tickets: await candidates(picked.repo, reads.source(picked.repo, picked.itemSource), records) }; }
  catch (err) { return { status: 502, error: `Can't read ${picked.repo}'s tickets. ${message(err)}` }; }
}

/** The body's ticket choices, or null when one has the wrong shape. */
function choicesOf(tickets: unknown): TicketImport[] | null {
  if (!Array.isArray(tickets)) return null;
  const fits = (t: unknown) => isRecord(t) && Number.isSafeInteger(t.number) && (t.number as number) > 0
    && (t.status === undefined || STATUSES.includes(t.status as Status)) && (t.placeHere === undefined || typeof t.placeHere === 'boolean');
  return tickets.every(fits) ? tickets as TicketImport[] : null;
}

/** The Status a choice imports its ticket with, or why it can't import yet. */
function statusFor(repo: string, ticket: ImportableTicket | undefined, choice: TicketImport): Status | { reason: string } {
  const ref = ticketOf(repo, choice.number);
  if (!ticket) return { reason: `${ref} isn't an open ticket with a status label or tag.` };
  if (ticket.untagged && !choice.placeHere) return { reason: `${ref} has no repo- tag. Confirm it is this repository's work.` };
  if (ticket.statuses.length === 1) return ticket.statuses[0]!;
  if (choice.status && ticket.statuses.includes(choice.status)) return choice.status;
  // An item source's read never carries Done.
  const carried = ticket.statuses.map((s) => statusLabel(s as Exclude<Status, 'Done'>));
  return { reason: `${ref} carries ${carried.slice(0, -1).join(', ')} and ${carried.at(-1)}. Choose its Status.` };
}

/**
 * Imports the body's chosen tickets: each one not yet recorded becomes a work record with its Status, ticket, text and
 * kind, and every ticket gets the named threads no record holds yet. Returns what each ticket did, or the status and
 * problem when the tickets or T3's threads can't be read, before anything is recorded.
 */
export async function importTickets(input: Record<string, unknown>, records: WorkRecords | null, reads: ImportReads = importReads):
  Promise<TicketsImported | Refused> {
  const picked = sourceOf(input);
  const choices = choicesOf(input.tickets);
  if (!picked || !choices) return { status: 400, error: `${SOURCE} Send each ticket's number, and the Status or placement it needs.` };
  if (!records) return NO_RECORDS;
  const { repo, itemSource } = picked;
  const source = reads.source(repo, itemSource);
  let offered, threadsOf;
  try { offered = new Map((await candidates(repo, source, records)).map((ticket) => [ticket.number, ticket])); }
  catch (err) { return { status: 502, error: `Can't read ${repo}'s tickets. ${message(err)}` }; }
  try { threadsOf = namedThreads(await reads.threads()); }
  catch (err) { return { status: 502, error: `Can't read T3 Code's threads. ${message(err)}` }; }
  const recorded = new Set(records.list({}).flatMap((r) => records.threads(r.workId).map((thread) => thread.threadId)));
  const answer: TicketsImported = { imported: [], refused: [] };
  for (const choice of choices) {
    const status = statusFor(repo, offered.get(choice.number), choice);
    if (typeof status !== 'string') { answer.refused.push({ number: choice.number, ...status }); continue; }
    const ticket = ticketOf(repo, choice.number);
    try {
      let record = holders(repo, records).get(ticket.toLowerCase());
      let created = false;
      if (!record) {
        const read = await source.readTicket(repo, choice.number);
        if (!read) { answer.refused.push({ number: choice.number, reason: `${ticket} is no longer open.` }); continue; }
        ({ record, created } = records.importTicket({ title: read.title, context: read.text, repository: repo, kind: read.kind, status, ticket }));
      }
      let threads = 0;
      for (const { threadId, purpose } of threadsOf(repo, choice.number)) {
        if (recorded.has(threadId)) continue;
        record = records.addThread(record.workId, record.revision, threadId, purpose);
        recorded.add(threadId);
        threads++;
      }
      answer.imported.push({ number: choice.number, workId: record.workId, created, threads });
    } catch (err) {
      answer.refused.push({ number: choice.number, reason: `Can't import ${ticket}. ${message(err)}` });
    }
  }
  return answer;
}
