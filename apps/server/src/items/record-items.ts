// The board's items: the work records of the onboarded repositories, each with its ticket's context when an item source
// read the ticket. The record owns Status, kind, title, structure, blockers and slices; the ticket adds its URL, labels,
// PRs and provider fields, so a ticket edit never moves, retitles, restructures or blocks work.

import { parseConceptMap, refKey, sameRepo } from '@lar-factory/shared';
import type { Blocker, IssueRef, Item, NeedsYouOffer, RepositorySetup, Slice, SliceProgress } from '@lar-factory/shared';
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

/**
 * Why the record waits on the user, with what its observations offer: a PR closed unmerged offers reopening it, a
 * replacement build and setting the work aside; a ticket closed before the work was Done offers setting it aside; a
 * ticket open on Done work offers reopening the work. Undefined when it doesn't wait.
 */
function needsYouOf(records: WorkRecords, record: WorkRecord): Item['needsYou'] {
  if (!record.needsYou) return undefined;
  const observed = (of: 'ticket' | 'pr') => records.observations(record.workId).find((o) => o.of === of)?.state;
  const done = isDone(record);
  const offers = new Set<NeedsYouOffer>();
  if (observed('pr') === 'closed') for (const offer of ['reopen-pr', 'replace-pr', 'set-aside'] as const) offers.add(offer);
  if (observed('ticket') === 'closed' && !done) offers.add('set-aside');
  if (observed('ticket') === 'open' && done) offers.add('reopen-work');
  return { reason: record.needsYou, offers: [...offers] };
}

/** Each repository's settings that changed since the user last accepted its setup. */
type Paused = readonly Pick<RepositorySetup, 'repo' | 'paused'>[];

/**
 * Why the record waits for its repository's changed setup to be accepted: an item-source change holds work with a
 * ticket, and a domain-doc-location change holds all work not Done. Undefined when no change affects it.
 */
function pausedOf(record: WorkRecord, paused: Paused): string | undefined {
  const changed = paused.find((p) => sameRepo(p.repo, record.repository))?.paused ?? [];
  const what = [
    ...changed.includes('itemSource') && record.ticket !== null && !isDone(record) ? ['item source'] : [],
    ...changed.includes('domainDocs') && !isDone(record) ? ['domain-doc location'] : [],
  ];
  return what.length ? `Its repository's ${what.join(' and ')} changed. Accept the change in Settings › Repositories to go on.` : undefined;
}

/** The ticket items an item source read, by their lowercase reference, `owner/name#12`, in each repository that lists them. */
export function ticketsByReference(tickets: readonly Item[]): Map<string, Item> {
  const byTicket = new Map<string, Item>();
  for (const ticket of tickets) {
    for (const repo of [ticket.repo, ...ticket.untaggedFor ?? []]) byTicket.set(refKey(repo, ticket.number).toLowerCase(), ticket);
  }
  return byTicket;
}

/** Maps records to board items with the ticket items an item source read, each paused as `paused` says. */
function itemMapper(records: WorkRecords, tickets: readonly Item[], paused: Paused = []) {
  const byTicket = ticketsByReference(tickets);
  const ticketOf = (record: WorkRecord) => (record.ticket ? byTicket.get(record.ticket.toLowerCase()) : undefined);
  const ref = (record: WorkRecord): IssueRef => ({ number: ticketNumber(record.ticket), title: record.title, url: ticketOf(record)?.url ?? '',
    repo: record.repository, state: state(record) });
  const toItem = (record: WorkRecord): Item => {
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
    const pause = pausedOf(record, paused);
    if (pause) item.paused = pause;
    const needsYou = needsYouOf(records, record);
    if (needsYou) item.needsYou = needsYou;
    return item;
  };
  return { ticketOf, toItem };
}

/** Whether the record is work the board lists: not a slice, in one of `repos`. */
const listed = (record: WorkRecord, repos: readonly string[]) => record.kind !== 'slice' && repos.some((repo) => sameRepo(repo, record.repository));

/**
 * Every board item from the records of `repos`, in the records' order, with the ticket items an item source read,
 * less set-aside work and the work IDs in `hidden`, which retention hides. In a repository of `unread`, whose source
 * hasn't read yet, a record with a ticket waits until its ticket is read. Work a repository's changed setup in `paused`
 * affects says why it waits.
 */
export function recordItems(records: WorkRecords, tickets: readonly Item[], repos: readonly string[], unread: readonly string[] = [],
  hidden: ReadonlySet<string> = new Set(), paused: Paused = []): Item[] {
  const { ticketOf, toItem } = itemMapper(records, tickets, paused);
  const waits = (record: WorkRecord) => record.ticket !== null && !ticketOf(record) && unread.some((repo) => sameRepo(repo, record.repository));
  return records.list({}).filter((r) => !r.setAside && !hidden.has(r.workId) && listed(r, repos) && !waits(r)).map(toItem);
}

/** Archive's items: the set-aside work of `repos` and the work in `hidden`, in the records' order, each with its `archived` facts. */
export function archivedItems(records: WorkRecords, tickets: readonly Item[], repos: readonly string[], hidden: ReadonlySet<string>): Item[] {
  const { ticketOf, toItem } = itemMapper(records, tickets);
  return records.list({}).filter((r) => (r.setAside || hidden.has(r.workId)) && listed(r, repos)).map((record) => ({
    ...toItem(record), archived: { setAside: record.setAside, hidden: hidden.has(record.workId), ticketOpen: ticketOf(record)?.state === 'open' },
  }));
}
