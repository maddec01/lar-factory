import { openQuestionThread, workingAgain, type Item, type LinkedPr } from './model.ts';
import { verificationProblem } from './verification.ts';

export const MERGE_METHODS = {
    merge: 'Merge commit',
    squash: 'Squash',
    rebase: 'Rebase and fast-forward',
    rebaseMerge: 'Rebase with merge commit',
} as const;
export type MergeMethod = keyof typeof MERGE_METHODS;

export interface MergeConfirmation {
    token: string;
    url: string;
    number: number;
    sourceRevision: string;
    methods: MergeMethod[];
}

/** A recorded stage is required independently of provider checks and permissions. */
export function mergeStageProblem(item: Item): string | undefined {
    if (item.status !== 'Ready to merge') return 'Finish the required verification and reach Ready to merge first.';

    const verify = verificationProblem(item, item.linkedPrs[0]?.sourceRevision);

    if (verify) return verify;

    if (item.paused || item.archived || item.needsYou || openQuestionThread(item))
        return 'Resolve the question or notice before merging.';

    if (item.threads === 'unavailable') return 'Thread activity is unavailable. Refresh before merging.';

    if (workingAgain(item)) return 'The build is still active. Wait for it to finish.';

    return undefined;
}

/** Check counts can block a merge, but cannot establish permission or policy approval. */
export function mergePrProblems(pr: LinkedPr): string[] {
    const problems: string[] = [];

    if (pr.state !== 'open') problems.push(pr.state === 'merged' ? 'This PR has merged.' : 'This PR is closed.');

    if (pr.isDraft) problems.push('This PR is a draft.');

    if (pr.checks?.failed) problems.push('Checks failed.');

    if (pr.checks?.running) problems.push('Checks are running.');

    if (pr.checks && pr.checks.total !== pr.checks.passed + pr.checks.failed + pr.checks.running)
        problems.push('Check results are unknown.');

    if (pr.mergeState !== 'can merge')
        problems.push(
            pr.mergeState === 'conflicts'
                ? 'Resolve conflicts before merging.'
                : 'Provider readiness is blocked or unknown. Check reviews and policies.',
        );

    if (pr.pipelineUnread || (pr.checkProgress && pr.checkProgress.state !== 'current'))
        problems.push('Current revision evidence is unavailable.');

    return problems;
}
