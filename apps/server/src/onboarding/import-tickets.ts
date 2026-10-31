// Onboarding's one-time import, in its first step: the repository's open tickets carrying a status label or tag become
// work records with that Status, original refinement and selected structure, with T3 threads matched once. Closed native
// concept parts preserve history; open parts still need a pick. Nothing is written to the provider. A repeated import
// fills absent refinement from initial context and preserves local bodies, relationships and recorded completion.

import {
  STATUSES, isRecord, labelStatuses, onAzure, statusLabel, type ImportableTicket, type Item, type RepositoryItemSource, type Status, type TicketImport,
  type TicketsImported,
} from '@lar-factory/shared';
import type { WorkKind, WorkRecord, WorkRecords } from '@lar-factory/work-records';
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
async function candidates(repo: string, source: ItemSource, records: WorkRecords, listed?: Item[]): Promise<ImportableTicket[]> {
  const items = (listed ?? (await source.read()).items).filter((item: Item) => item.state === 'open' && item.statuses.length > 0 && item.number > 0);
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


/** The legacy labels distinguish structural work from its generic provider kind. */
function legacyKind(item: Item, fallback: WorkKind): WorkKind {
  if (item.labels?.some(label => label.startsWith('decision-'))) return 'decision';
  if (item.labels?.includes('build')) return 'build';
  return item.kind === 'concept' ? 'concept' : fallback;
}

/** Correct the original generic provider kind only while the imported record has no refinement. */
function normalizeLegacyKind(records: WorkRecords, record: WorkRecord, item: Item): WorkRecord {
  const kind = legacyKind(item, record.kind);
  if (kind !== record.kind && record.kind === item.kind && !record.parentId &&
    ['map', 'brief', 'decision'].every(body => records.body(record.workId, body as 'map' | 'brief' | 'decision') === null)) {
    record = records.update(record.workId, record.revision, { kind });
  }
  return record;
}

/** Restore absent refinement and selected edges atomically; the existing body protects later local edits. */
function restoreStructure(records: WorkRecords, imported: Map<string, Item>, answer: TicketsImported): void {
  const held = new Map(records.list({}).flatMap(record => record.ticket ? [[record.ticket.toLowerCase(), record] as const] : []));
  for (const [workId, item] of imported) {
    try {
      const record = records.read(workId);
      const parent = item.parent && held.get(ticketOf(item.parent.repo, item.parent.number).toLowerCase());
      const parentId = parent && parent.workId !== workId &&
        (parent.kind === 'concept' && ['build', 'decision'].includes(record.kind) || parent.kind === 'build' && record.kind === 'slice') ? parent.workId : undefined;
      const blockerIds = (item.blockers ?? []).flatMap(ref => {
        const blocker = held.get(ticketOf(ref.repo, ref.number).toLowerCase());
        return blocker ? [blocker.workId] : [];
      });
      records.restoreImported(workId, record.revision, { body: record.kind === 'concept' ? 'map' : record.kind === 'decision' ? 'decision' : 'brief',
        markdown: records.initialContext(workId), ...(parentId && { parentId }), blockerIds });
    } catch (err) {
      answer.refused.push({ number: item.number, reason: `Its legacy refinement and relationships could not be restored. ${message(err)}` });
    }
  }
}

/** Closed native parts are history of the selected concept; open parts still need an explicit pick. */
async function restoreHistory(repo: string, source: ItemSource, records: WorkRecords, selected: Item[], answer: TicketsImported, threadsOf: ReturnType<typeof namedThreads>, recorded: Set<string>): Promise<void> {
  for (const item of selected) {
    const parent = holders(repo, records).get(ticketOf(repo, item.number).toLowerCase());
    if (!parent || parent.kind !== 'concept') continue;
    if (!source.legacyChildren) {
      if ((item.subIssues?.completed ?? 0) > 0) answer.refused.push({ number: item.number,
        reason: 'This provider cannot yet restore all closed historical parts. The concept map is preserved; recover the missing history before continuing.' });
      continue;
    }
    try {
      for (const child of await source.legacyChildren(repo, item.number)) {
        const metadata = { ...item, number: child.number, title: child.title, kind: child.kind, labels: child.labels,
          parent: { repo, number: item.number, title: item.title, url: item.url ?? '', state: item.state }, blockers: [], state: child.state } satisfies Item;
        const imported = records.importTicket({ title: child.title, context: child.text, repository: repo,
          kind: legacyKind(metadata, child.kind), status: labelStatuses(child.labels)[0] ?? 'List', ticket: ticketOf(repo, child.number) });
        let record = normalizeLegacyKind(records, imported.record, metadata);
        record = records.restoreImported(record.workId, record.revision, { body: record.kind === 'decision' ? 'decision' : 'brief',
          markdown: records.initialContext(record.workId), parentId: parent.workId });
        if (imported.created && child.notPlanned) record = records.setAside(record.workId, record.revision);
        else if (child.mergedPr && record.kind === 'build' && !record.setAside) {
          if (!record.pullRequest) record = records.setPullRequest(record.workId, record.revision, child.mergedPr);
          if (record.pullRequest === child.mergedPr && records.observations(record.workId).find(observation => observation.of === 'pr')?.state !== 'merged') {
            record = records.observe(record.workId, record.revision, { of: 'pr', state: 'merged' });
          }
        } else if (!record.needsYou && !records.completion(record.workId).complete && imported.created) {
          record = records.setNeedsYou(record.workId, record.revision, `Imported closed history from ${ticketOf(repo, child.number)}. Confirm its decision completion or merged PR; a closed ticket alone does not complete local work.`);
        }
        for (const { threadId, purpose } of threadsOf(repo, child.number)) {
          if (recorded.has(threadId)) continue;
          record = records.addThread(record.workId, record.revision, threadId, purpose);
          recorded.add(threadId);
        }
      }
    } catch (err) {
      answer.refused.push({ number: item.number, reason: `Its closed parts could not all be restored. ${message(err)}` });
    }
  }
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
  let offered, threadsOf, listed: Item[];
  try { listed = (await source.read()).items; offered = new Map((await candidates(repo, source, records, listed)).map((ticket) => [ticket.number, ticket])); }
  catch (err) { return { status: 502, error: `Can't read ${repo}'s tickets. ${message(err)}` }; }
  try { threadsOf = namedThreads(await reads.threads()); }
  catch (err) { return { status: 502, error: `Can't read T3 Code's threads. ${message(err)}` }; }
  const recorded = new Set(records.list({}).flatMap((r) => records.threads(r.workId).map((thread) => thread.threadId)));
  const answer: TicketsImported = { imported: [], refused: [] };
  const structure = new Map<string, Item>();
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
        ({ record, created } = records.importTicket({ title: read.title, context: read.text, repository: repo, kind: legacyKind(listed.find(item => item.number === choice.number)!, read.kind), status, ticket }));
      }
      const item = listed.find(item => item.number === choice.number)!;
      record = normalizeLegacyKind(records, record, item);
      structure.set(record.workId, item);
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
  await restoreHistory(repo, source, records, listed.filter(item => answer.imported.some(imported => imported.number === item.number)), answer, threadsOf, recorded);
  restoreStructure(records, structure, answer);
  return answer;
}
