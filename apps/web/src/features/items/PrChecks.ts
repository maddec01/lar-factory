// An open pull request's checks: what its card and row show in place of its workflow and slice tracks from the moment
// the PR opens, so a PR whose checks all passed reads as ready to merge at a glance.

import type { BoardData, Checks, Item, LinkedPr } from '@lar-factory/shared';

/**
 * Whether the board can't vouch that `pr`'s checks are current: the board lost its server, the latest read left the
 * item's repository off, or the PR's observation went stale. Stale checks keep their last known counts, dimmed.
 */
export const checksStale = (
    item: Pick<Item, 'repo'>,
    pr: LinkedPr,
    data: Pick<BoardData, 'itemSourceProblems'>,
    disconnected: boolean,
): boolean =>
    disconnected ||
    !!data.itemSourceProblems?.some((problem) => problem.repo === item.repo) ||
    pr.checkProgress?.state === 'stale';

/** The open PR's checks once read, and whether they are stale; null with no open PR or no checks to count. */
export function prChecks(
    item: Pick<Item, 'repo' | 'linkedPrs'>,
    data: Pick<BoardData, 'itemSourceProblems'>,
    disconnected: boolean,
): { checks: Checks; stale: boolean } | null {
    const pr = item.linkedPrs[0];

    // Checks the board can't read at all keep their warning in words instead.
    if (
        !pr ||
        pr.state !== 'open' ||
        pr.pipelineUnread ||
        pr.checkProgress?.state === 'unavailable' ||
        !pr.checks ||
        pr.checks.total === 0
    )
        return null;

    return { checks: pr.checks, stale: checksStale(item, pr, data, disconnected) };
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
