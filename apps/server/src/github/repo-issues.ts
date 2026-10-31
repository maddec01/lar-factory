// The repository issues item source: reads one repository's issues through github.ts, and closes one on Abandon's close.

import { TICKET_MATCHES, ticketNumberOf, type ItemSource } from '../items/item-source.ts';
import { changedSince, abandonIssue, fetchIssues, fetchRepoIssues, getIfChanged, findIssues, observeIssue, readIssue } from './github.ts';

/** How many of the latest updated issues and PRs a change check lists; when all of them changed, the whole source reads. */
const CHANGES_PAGE = 30;

/** `run` stands in for gh in tests; the github.ts functions use gh when it is undefined. */
export function repoIssues(repo: string, run?: (args: string[]) => Promise<string>): ItemSource {
  // Whether a read succeeded, after which a read searches the closed issues only when their one page might miss some.
  let readOnce = false;
  // The last change check's ETag, so the next one is a free 304 while nothing changed.
  let etag: string | undefined;
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
    async searchTickets(_repo, query) {
      const number = ticketNumberOf(query);
      if (number === null) return findIssues(repo, query, TICKET_MATCHES, run);
      const issue = await readIssue(repo, number, run);
      return issue ? [{ number: issue.number, title: issue.title, url: issue.url }] : [];
    },
    readTicket: (_repo, number) => readIssue(repo, number, run),
    observeTicket: (_repo, number) => observeIssue(repo, number, run),
    abandon: (item) => abandonIssue(item, run),
  };
}
