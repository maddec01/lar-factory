// A build's pull request checks, once its work is in review: what its card and row show in place of its workflow and
// slice tracks, so a PR whose checks all passed reads as ready to merge at a glance.

import type { Checks, Item } from '@lar-factory/shared';

/** The stages after the build, where the PR's pipeline is what moves. */
const IN_REVIEW: readonly Item['status'][] = ['Review', 'Verify', 'Ready to merge'];

/** The open PR's checks once the work is in review and they have been read; null otherwise. */
export function prChecks(item: Pick<Item, 'status' | 'linkedPrs'>): Checks | null {
    const pr = item.linkedPrs[0];

    // Checks the board can't vouch for (stale or unavailable) keep the counts in words with their warning instead.
    if (
        !IN_REVIEW.includes(item.status) ||
        !pr ||
        pr.state !== 'open' ||
        pr.pipelineUnread ||
        (pr.checkProgress && pr.checkProgress.state !== 'current')
    )
        return null;

    return pr.checks && pr.checks.total > 0 ? pr.checks : null;
}

/** The checks in a row's few words: how many passed while any run, a failure, or that all passed. */
export const checksCount = ({ passed, failed, running, total }: Checks): string =>
    failed
        ? `${failed} ${failed === 1 ? 'check' : 'checks'} failed`
        : running || passed < total
          ? `${passed}/${total} checks`
          : 'Checks passed';

/** The checks in a card's fewest words, beside the pull request's mark: "1 failed", "3/5" or "passed". */
export const checksWord = ({ passed, failed, running, total }: Checks): string =>
    failed ? `${failed} failed` : running || passed < total ? `${passed}/${total}` : 'passed';
