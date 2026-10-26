// The repository issues item source: reads and writes one repository's issues through github.ts, with no Project.
// Until status labels come in build #379, every open issue is List and a status write is refused.

import type { ItemSource } from '../items/item-source.ts';
import { addIssueLabel, createIssue, deleteIssue, fetchRepoIssues } from './github.ts';

const STATUS_LABELS = "Moving an issue from a repository's issues needs status labels, which come in build #379.";

export function repoIssues(repo: string): ItemSource {
  return {
    read: async () => ({ title: repo, items: await fetchRepoIssues(repo) }),
    setStatus: async () => STATUS_LABELS,
    statusRefusal: () => STATUS_LABELS,
    addLabel: (item, label) => addIssueLabel(item.repo!, item.number!, label),
    create: (draft, progress) => createIssue(draft, progress),
    setParentStatus: async () => STATUS_LABELS,
    abandon: (item) => deleteIssue(item),
  };
}
