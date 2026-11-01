// The board's items: the work records of the onboarded repositories, each with its ticket's context when an item source
// read the ticket. The record owns Status, kind, title, structure, blockers, Dependencies and slices; the ticket adds its URL, labels,
// PRs and provider fields. Spec sync can update title and brief; it never moves, restructures or blocks work.

import { onAzure, parseConceptMap, refKey, sameRepo } from '@lar-factory/shared';
import type { Blocker, DependencyHold, IssueRef, Item, NeedsYouOffer, Slice, SliceProgress } from '@lar-factory/shared';
import type { Dependency, WorkRecord, WorkRecords } from '@lar-factory/work-records';
import { workItemUrl } from '../azure/azure-items.ts';
import { prUrl } from '../config/pr-host.ts';

/** The number in a ticket reference, `owner/name#12`. */
const ticketNumber = (ticket: string | null): number => (ticket ? Number(ticket.slice(ticket.lastIndexOf('#') + 1)) : 0);

/** The page of a ticket or PR reference: a GitHub issue or PR, or an Azure DevOps work item or PR. */
function referenceUrl(reference: string, pr: boolean): string {
  const repo = reference.slice(0, reference.lastIndexOf('#'));
  const number = ticketNumber(reference);
  if (pr) return prUrl(repo, number);
  const [organization, project] = repo.split('/');
  return onAzure(repo) ? workItemUrl(organization!, project!, number) : `https://github.com/${repo}/issues/${number}`;
}

/** A Dependency as the blocker it is for each build it holds: open until the user marks it met, which no observation decides. */
function dependencyBlocker(d: Dependency): Blocker {
  const observation = d.observations.reduce<DependencyHold['observation']>((latest, o) => (!latest || o.observedAt > latest.observedAt ? o : latest), null);
  const named = [...d.ticket ? [{ reference: d.ticket, url: referenceUrl(d.ticket, false) }] : [],
    ...d.pullRequests.map((pr) => ({ reference: pr, url: referenceUrl(pr, true) }))];
  const hold: DependencyHold = { dependencyId: d.dependencyId, revision: d.revision, owner: d.owner, need: d.need, ticket: d.ticket, named,
    evidence: d.evidence, met: d.met, needsReview: d.needsReview, observation };
  return { number: ticketNumber(d.ticket), repo: d.ticket ? d.ticket.slice(0, d.ticket.lastIndexOf('#')) : d.owner, state: d.met ? 'closed' : 'open',
    title: d.need, dependency: hold };
}

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

/** The ticket items an item source read, by their lowercase reference, `owner/name#12`, in each repository that lists them. */
export function ticketsByReference(tickets: readonly Item[]): Map<string, Item> {
  const byTicket = new Map<string, Item>();
  for (const ticket of tickets) {
    for (const repo of [ticket.repo, ...ticket.untaggedFor ?? []]) byTicket.set(refKey(repo, ticket.number).toLowerCase(), ticket);
  }
  return byTicket;
}

/** Maps records and their local completion facts to board items, alongside their latest ticket context. */
function itemMapper(records: WorkRecords, tickets: readonly Item[], setups: readonly {repo:string;structureSync?:boolean;writeRefinedSpec?:boolean}[] = []) {
  const byTicket = ticketsByReference(tickets);
  const completions = new Map<string, ReturnType<WorkRecords['completion']>>();
  const completionOf = (record: WorkRecord) => {
    let completion = completions.get(record.workId);
    if (!completion) { completion = records.completion(record.workId); completions.set(record.workId, completion); }
    return completion;
  };
  const ticketOf = (record: WorkRecord) => (record.ticket ? byTicket.get(record.ticket.toLowerCase()) : undefined);
  const ref = (record: WorkRecord): IssueRef => ({ number: ticketNumber(record.ticket), title: record.title, url: ticketOf(record)?.url ?? '',
    repo: record.repository, state: state(record) });
  const toItem = (record: WorkRecord): Item => {
    const ticket = ticketOf(record);
    const attachment = records.publicationAttachment(record.workId);
    const parent = record.parentId ? records.read(record.parentId) : null;
    const children = records.children(record.workId).filter((c) => !c.setAside);
    // A blocker holds the work until its local facts complete it; its Status, its ticket closing and its thread ending never do.
    const blockers = records.blockers(record.workId).map((b): Blocker => ({ number: ticketNumber(b.ticket), repo: b.repository,
      state: completionOf(b).complete ? 'closed' : 'open', workId: b.workId, title: b.title }))
      .concat(record.kind === 'build' ? records.blockingDependencies(record.workId).map(dependencyBlocker) : []);
    const slices = children.filter((c) => c.kind === 'slice').map((c): Slice => ({ ...ref(c), progress: sliceProgress(c), workId: c.workId }));
    const work = children.filter((c) => c.kind !== 'slice');
    const mapBody = record.kind === 'concept' ? records.body(record.workId, 'map') : null;
    const map = mapBody !== null ? parseConceptMap(mapBody) : record.kind === 'concept' ? ticket?.map ?? parseConceptMap('') : ticket?.map;
    const done = isDone(record);
    const sync = setups.find(setup=>sameRepo(setup.repo,record.repository))?.structureSync === false ? undefined : records.trackerState(record.workId);
    const spec = setups.find(setup => sameRepo(setup.repo, record.repository))?.writeRefinedSpec === false ? null : records.specState(record.workId);
    const item: Item = {
      content: 'ticket', labels: [], linkedPrs: [], ...ticket && { labels: ticket.labels, linkedPrs: ticket.linkedPrs },
      ...ticket?.azure && { azure: ticket.azure }, ...ticket?.sourceOrder !== undefined && { sourceOrder: ticket.sourceOrder },
      ...ticket?.abandonRefusal && { abandonRefusal: ticket.abandonRefusal }, ...ticket?.currentSprint && { currentSprint: ticket.currentSprint },
      id: record.workId,
      recorded: true,
      completion: completionOf(record),
      ...(ticket?.tracker && {tracker: ticket.tracker}),
      ...(sync && {sync}),
      ...(spec && (spec.pending !== null || spec.error || spec.warning) && { specSync: { pending: spec.pending !== null, error: spec.error, warning: spec.warning } }),
      revision: record.revision,
      status: record.status,
      statuses: done ? [] : [record.status],
      kind: record.kind === 'slice' ? 'issue' : record.kind,
      number: ticketNumber(record.ticket),
      title: record.title || ticket?.title || '',
      url: ticket?.url ?? attachment?.url ?? null,
      repo: record.repository,
      state: state(record),
      closedAs: done ? 'done' : null,
      parent: parent ? ref(parent) : ticket?.parent ?? null,
      parentId: record.parentId,
      subIssues: { total: work.length, completed: work.filter(child => completionOf(child).complete).length },
      blockers,
      updatedAt: [record.updatedAt, spec?.changedAt ?? ''].sort().at(-1)!,
      closedAt: done ? record.finishedAt ?? record.updatedAt : null,
      slices,
    };
    if (map) item.map = map;
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
 * hasn't read yet, a record with a ticket waits until its ticket is read.
 */
export function recordItems(records: WorkRecords, tickets: readonly Item[], repos: readonly string[], unread: readonly string[] = [],
  hidden: ReadonlySet<string> = new Set(), setups: readonly {repo:string;structureSync?:boolean;writeRefinedSpec?:boolean}[] = []): Item[] {
  const { ticketOf, toItem } = itemMapper(records, tickets, setups);
  const waits = (record: WorkRecord) => record.ticket !== null && !ticketOf(record) && unread.some((repo) => sameRepo(repo, record.repository));
  const all = records.list({});
  const held = new Set(all.flatMap(record => record.ticket ? [record.ticket.toLowerCase()] : []));
  const unpicked = tickets.filter(ticket => repos.some(repo=>sameRepo(repo,ticket.repo)) && ticket.state === 'open' && !held.has(refKey(ticket.repo, ticket.number).toLowerCase()))
    .map((ticket): Item => ({...ticket, recorded: false, status: 'List', statuses: [], slices: []}));
  return [...all.filter((r) => !r.setAside && !hidden.has(r.workId) && listed(r, repos) && !waits(r)).map(toItem), ...unpicked];
}

/** Archive's items: the set-aside work of `repos` and the work in `hidden`, in the records' order, each with its `archived` facts. */
export function archivedItems(records: WorkRecords, tickets: readonly Item[], repos: readonly string[], hidden: ReadonlySet<string>): Item[] {
  const { ticketOf, toItem } = itemMapper(records, tickets);
  return records.list({}).filter((r) => (r.setAside || hidden.has(r.workId)) && listed(r, repos)).map((record) => ({
    ...toItem(record), archived: { setAside: record.setAside, hidden: hidden.has(record.workId), ticketOpen: ticketOf(record)?.state === 'open' },
  }));
}
