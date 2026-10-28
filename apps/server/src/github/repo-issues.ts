// The repository issues item source: reads and writes one repository's issues through github.ts, with no Project.
// An issue keeps its status as a status-<name> label, and each move swaps the old label for the new one.

import { carriesTwoStatuses, keepOneText, labelStatuses, statusLabel } from '@lar-factory/shared';
import type { Status } from '@lar-factory/shared';
import { DONE_REFUSED, type ItemSource } from '../items/item-source.ts';
import { addIssueLabel, createIssue, createStatusLabel, deleteIssue, fetchIssues, fetchRepoIssues, issueLabels, message, setStatusLabel } from './github.ts';

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
  /** Adds the status's label and removes every other status label the issue carries. */
  async function write(number: number, carried: readonly Status[], status: Status): Promise<string | null> {
    if (status === 'Done') return DONE_REFUSED;
    return (await ensureLabel(status)) ?? setStatusLabel(repo, number, status, carried, run);
  }
  return {
    read: async () => ({ title: repo, items: await fetchRepoIssues(repo) }),
    readSome: (items) => fetchIssues(items.map((item) => item.id)),
    setStatus: (item, status) => write(item.number!, item.statuses, status),
    statusRefusal: (item) => ('statuses' in item ? twoStatuses(item) : null),
    addLabel: (item, label) => addIssueLabel(item.repo!, item.number!, label, run),
    // The new issue gets status-list, so it shows on a repository that shows only Opted-in items.
    create: (draft, progress) => createIssue({ ...draft, labels: [...draft.labels, statusLabel('List')] }, progress, run, async () => {
      const error = await ensureLabel('List');
      if (error) throw new Error(error);
      return [];
    }),
    async setParentStatus(parent, status) {
      if (status === 'Done') return DONE_REFUSED;
      try {
        const carried = labelStatuses(await issueLabels(repo, parent.number, run));
        return twoStatuses({ statuses: carried, state: parent.state }) ?? (await write(parent.number, carried, status));
      } catch (err) {
        return `Could not set ${status}. ${message(err)}`;
      }
    },
    abandon: (item) => deleteIssue(item, run),
  };
}
