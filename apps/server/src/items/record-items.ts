// The board's items: the work records of the onboarded repositories, each with its ticket's context when an item source
// read the ticket. The record owns Status, kind, title, structure, blockers and slices; the ticket adds its URL, labels,
// PRs and provider fields, so a ticket edit never moves, retitles, restructures or blocks work.

import { parseConceptMap, refKey, sameRepo } from '@lar-factory/shared';
import type { Blocker, IssueRef, Item, Slice, SliceProgress } from '@lar-factory/shared';
import type { WorkRecord, WorkRecords } from '@lar-factory/work-records';

/** The number in a ticket reference, `owner/name#12`. */
const ticketNumber = (ticket: string | null): number => (ticket ? Number(ticket.slice(ticket.lastIndexOf('#') + 1)) : 0);

const isDone = (record: WorkRecord) => record.status === 'Done';
const state = (record: WorkRecord): 'open' | 'closed' => (isDone(record) ? 'closed' : 'open');

function sliceProgress(record: WorkRecord): SliceProgress {
  if (isDone(record) || record.finishedAt) return 'done';
  if (record.needsYou) return 'blocked';
  return record.status === 'In progress' ? 'active' : 'waiting';
}

/** The ticket items an item source read, by their lowercase reference, `owner/name#12`, in each repository that lists them. */
export function ticketsByReference(tickets: readonly Item[]): Map<string, Item> {
  const byTicket = new Map<string, Item>();
  for (const ticket of tickets) {
    for (const repo of [ticket.repo, ...ticket.untaggedFor ?? []]) byTicket.set(refKey(repo, ticket.number).toLowerCase(), ticket);
  }
  return byTicket;
}

/**
 * Every board item from the records of `repos`, in the records' order, with the ticket items an item source read. In
 * a repository of `unread`, whose source hasn't read yet, a record with a ticket waits until its ticket is read.
 */
export function recordItems(records: WorkRecords, tickets: readonly Item[], repos: readonly string[], unread: readonly string[] = []): Item[] {
  const byTicket = ticketsByReference(tickets);
  const ticketOf = (record: WorkRecord) => (record.ticket ? byTicket.get(record.ticket.toLowerCase()) : undefined);
  const ref = (record: WorkRecord): IssueRef => ({ number: ticketNumber(record.ticket), title: record.title, url: ticketOf(record)?.url ?? '',
    repo: record.repository, state: state(record) });

  const waits = (record: WorkRecord) => record.ticket !== null && !ticketOf(record) && unread.some((repo) => sameRepo(repo, record.repository));
  return records.list({}).filter((r) => !r.setAside && r.kind !== 'slice' && repos.some((repo) => sameRepo(repo, r.repository)) && !waits(r)).map((record) => {
    const ticket = ticketOf(record);
    const parent = record.parentId ? records.read(record.parentId) : null;
    const children = records.children(record.workId).filter((c) => !c.setAside);
    // A blocker holds the work until its local facts complete it; its Status, its ticket closing and its thread ending never do.
    const blockers = records.blockers(record.workId).map((b): Blocker => ({ number: ticketNumber(b.ticket), repo: b.repository,
      state: records.completion(b.workId).complete ? 'closed' : 'open', workId: b.workId, title: b.title }));
    const slices = children.filter((c) => c.kind === 'slice').map((c): Slice => ({ ...ref(c), progress: sliceProgress(c), workId: c.workId }));
    const work = children.filter((c) => c.kind !== 'slice');
    const mapBody = record.kind === 'concept' ? records.body(record.workId, 'map') : null;
    const map = mapBody !== null ? parseConceptMap(mapBody) : record.kind === 'concept' ? ticket?.map ?? parseConceptMap('') : ticket?.map;
    const done = isDone(record);
    const item: Item = {
      content: 'ticket', labels: [], linkedPrs: [], ...ticket && { labels: ticket.labels, linkedPrs: ticket.linkedPrs },
      ...ticket?.azure && { azure: ticket.azure }, ...ticket?.sourceOrder !== undefined && { sourceOrder: ticket.sourceOrder },
      ...ticket?.abandonRefusal && { abandonRefusal: ticket.abandonRefusal }, ...ticket?.currentSprint && { currentSprint: ticket.currentSprint },
      id: record.workId,
      revision: record.revision,
      status: record.status,
      statuses: done ? [] : [record.status],
      kind: record.kind === 'slice' ? 'issue' : record.kind,
      number: ticketNumber(record.ticket),
      title: record.title || ticket?.title || '',
      url: ticket?.url ?? null,
      repo: record.repository,
      state: state(record),
      closedAs: done ? 'done' : null,
      parent: parent && ref(parent),
      parentId: record.parentId,
      subIssues: { total: work.length, completed: work.filter(isDone).length },
      blockers,
      updatedAt: record.updatedAt,
      closedAt: done ? record.finishedAt ?? record.updatedAt : null,
      slices,
    };
    if (map) item.map = map;
    return item;
  });
}
