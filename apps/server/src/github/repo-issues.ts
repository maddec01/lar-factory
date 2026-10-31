// The repository issues item source: reads and writes one repository's issues through github.ts.
// An issue keeps its status as a status-<name> label, and each move swaps the old label for the new one.

import { carriesTwoStatuses, keepOneText, labelStatuses } from '@lar-factory/shared';
import type { Status } from '@lar-factory/shared';
import { DONE_REFUSED, TICKET_MATCHES, ticketNumberOf, type ItemSource } from '../items/item-source.ts';
import { addIssueLabel, changedSince, createStatusLabel, abandonIssue, fetchIssues, fetchRepoIssues, getIfChanged, issueLabels, message, findIssues, observeIssue, readIssue, setStatusLabel } from './github.ts';

/** How many of the latest updated issues and PRs a change check lists; when all of them changed, the whole source reads. */
const CHANGES_PAGE = 30;

/** Why an open issue carrying more than one status label can't move, or null when it carries at most one. */
const twoStatuses = (issue: { statuses: readonly Status[]; state: 'open' | 'closed' }): string | null =>
  (carriesTwoStatuses(issue) ? keepOneText(issue.statuses) : null);

/** `run` stands in for gh in tests; the github.ts functions use gh when it is undefined. */
export function repoIssues(repo: string, run?: (args: string[]) => Promise<string>): ItemSource {
  // The status labels this repository has, from a check or a creation this board run, so each is checked once.
  const known = new Set<Status>();
  async function ensureLabel(status: Exclude<Status, 'Done'>): Promise<string | null> {
    if (known.has(status)) return null;
    const error = await createStatusLabel(repo, status, run);
    if (!error) known.add(status);
    return error;
  }
  // Whether a read succeeded, after which a read searches the closed issues only when their one page might miss some.
  let readOnce = false;
  // The last change check's ETag, so the next one is a free 304 while nothing changed.
  let etag: string | undefined;
  /** Adds the status's label and removes every other status label the issue carries. */
  async function write(number: number, carried: readonly Status[], status: Status): Promise<string | null> {
    if (status === 'Done') return DONE_REFUSED;
    return (await ensureLabel(status)) ?? setStatusLabel(repo, number, status, carried, run);
  }
  return {
    async read() {
      const items = await fetchRepoIssues(repo, Date.now(), { searchRanges: !readOnce });
      readOnce = true;
      return { title: repo, items };
    },
    readSome: (items) => fetchIssues(items.map((item) => item.id)),
    // Labels, closes and sub-issues each move an issue's updated_at, and pushes a PR's, so the check sees every edit to an item.
    seesEdits: true,
    async changes(since) {
      const answer = await getIfChanged<{ html_url: string; updated_at: string; closed_at: string | null }[]>(
        `repos/${repo}/issues?state=all&sort=updated&direction=desc&per_page=${CHANGES_PAGE}`, etag, run);
      if (!answer) return [];
      etag = answer.etag;
      if (answer.body.length === CHANGES_PAGE && answer.body.every((issue) => changedSince(issue.updated_at, since))) return null;
      // An edit to an issue that closed before the check, such as a comment on an old one, changes nothing the board shows.
      return answer.body.filter((issue) => changedSince(issue.updated_at, since) && (!issue.closed_at || changedSince(issue.closed_at, since)))
        .map((issue) => issue.html_url);
    },
    setStatus: (item, status) => write(item.number!, item.statuses, status),
    statusRefusal: (item) => ('statuses' in item ? twoStatuses(item) : null),
    addLabel: (item, label) => addIssueLabel(item.repo!, item.number!, label, run),
    async searchTickets(_repo, query) {
      const number = ticketNumberOf(query);
      if (number === null) return findIssues(repo, query, TICKET_MATCHES, run);
      const issue = await readIssue(repo, number, run);
      return issue ? [{ number: issue.number, title: issue.title, url: issue.url }] : [];
    },
    readTicket: (_repo, number) => readIssue(repo, number, run),
    observeTicket: (_repo, number) => observeIssue(repo, number, run),
    async setParentStatus(parent, status) {
      if (status === 'Done') return DONE_REFUSED;
      try {
        const carried = labelStatuses(await issueLabels(repo, parent.number, run));
        return twoStatuses({ statuses: carried, state: parent.state }) ?? (await write(parent.number, carried, status));
      } catch (err) {
        return `Could not set ${status}. ${message(err)}`;
      }
    },
    abandon: (item) => abandonIssue(item, run),
  };
}
