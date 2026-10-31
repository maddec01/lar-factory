// An Azure work item's linked pull requests, each read with one az repos pr show: its state and merge status, with no
// checks. Branch policies (az repos pr policy list) would take a second call per PR, so the board leaves them out.

import type { LinkedPr, MergeState } from '@lar-factory/shared';
import type { RawWorkItem } from './azure-items.ts';

/** A pull request as az repos pr show prints it. */
export interface AzurePr {
  pullRequestId: number;
  lastMergeSourceCommit?: { commitId: string };
  status: 'active' | 'completed' | 'abandoned';
  isDraft?: boolean;
  mergeStatus?: string;
  description?: string;
  closedDate?: string | null;
  repository: { webUrl: string };
}

/** A PR's state on the board: active is open, a draft too; completed is merged; abandoned is closed. */
export const prStateOf = (pr: Pick<AzurePr, 'status'>): LinkedPr['state'] =>
  (pr.status === 'completed' ? 'merged' : pr.status === 'abandoned' ? 'closed' : 'open');

/** Azure's merge status, in the board's four: succeeded can merge, conflicts conflicts, rejectedByPolicy and failure are blocked, the rest checking. */
const mergeStateOf = (status: string | undefined): MergeState =>
  (status === 'succeeded' ? 'can merge' : status === 'conflicts' ? 'conflicts' : status === 'rejectedByPolicy' || status === 'failure' ? 'blocked' : 'checking');

/** The ids of the PRs a work item links, each an ArtifactLink to vstfs:///Git/PullRequestId/<project>%2F<repository>%2F<id>. */
export const prIds = (raw: RawWorkItem): number[] => (raw.relations ?? []).flatMap(({ rel, url }) => {
  const id = rel === 'ArtifactLink' ? /^vstfs:\/\/\/Git\/PullRequestId\/[^/]+%2F[^/]+%2F(\d+)$/i.exec(url)?.[1] : undefined;
  return id ? [Number(id)] : [];
});

/** The PR as the board shows it on its linked work item. */
export function linkedPr(pr: AzurePr): LinkedPr {
  const state = prStateOf(pr);
  return {
    ...pr.lastMergeSourceCommit?.commitId && { sourceRevision: pr.lastMergeSourceCommit.commitId },
    number: pr.pullRequestId, url: `${pr.repository.webUrl}/pullrequest/${pr.pullRequestId}`, state, isDraft: pr.isDraft === true,
    body: pr.description ?? '', mergedAt: state === 'merged' ? pr.closedDate ?? null : null, checks: null, mergeState: mergeStateOf(pr.mergeStatus),
  };
}
