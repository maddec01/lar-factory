// The repository issues item source: reads one repository's issues through github.ts. Writes come in a later
// slice; until then each is refused, so none reaches the Project.

import type { ItemSource } from '../items/item-source.ts';
import { fetchRepoIssues } from './github.ts';

export function repoIssues(repo: string): ItemSource {
  const refusal = `The board can't change ${repo}'s items yet: it reads them from the repository's issues, not the Project.`;
  const refuse = async () => refusal;
  return {
    read: async () => ({ title: repo, items: await fetchRepoIssues(repo) }),
    setStatus: refuse,
    addLabel: refuse,
    create: async () => ({ item: null, issueUrl: null, error: refusal }),
    setParentStatus: refuse,
    abandon: refuse,
  };
}
