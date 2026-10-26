// The repository issues item source: reads and writes one repository's issues through github.ts, with no Project.
// An issue keeps its status as a status-<name> label, and each move swaps the old label for the new one.

import { carriesTwoStatuses, keepOneText, labelStatuses, statusLabel } from '@lar-factory/shared';
import type { Status } from '@lar-factory/shared';
import { DONE_REFUSED, type ItemSource } from '../items/item-source.ts';
import { addIssueLabel, createIssue, createStatusLabel, deleteIssue, fetchRepoIssues, issueLabels, setStatusLabel } from './github.ts';

/** Why an issue carrying more than one status label can't move, or null when it carries at most one. */
const twoStatuses = (statuses: readonly Status[]): string | null => (carriesTwoStatuses({ statuses }) ? keepOneText(statuses) : null);

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
  async function write(number: number, carried: readonly Status[], status: Status): Promise<string | null> {
    if (status === 'Done') return DONE_REFUSED;
    return twoStatuses(carried) ?? (await ensureLabel(status)) ?? setStatusLabel(repo, number, status, carried, run);
  }
  return {
    read: async () => ({ title: repo, items: await fetchRepoIssues(repo) }),
    setStatus: (item, status) => write(item.number!, item.statuses, status),
    statusRefusal: (item) => ('statuses' in item ? twoStatuses(item.statuses) : null),
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
        return await write(parent.number, labelStatuses(await issueLabels(repo, parent.number, run)), status);
      } catch (err) {
        return `Could not set ${status}. ${err instanceof Error ? err.message : 'GitHub request failed.'}`;
      }
    },
    abandon: (item) => deleteIssue(item, run),
  };
}
