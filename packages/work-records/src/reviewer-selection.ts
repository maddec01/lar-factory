import { parseFactorySettings, reviewerInstructions } from '@lar-factory/shared/factory-settings';

import { matchReviewerTrigger, type ReviewDiff } from './reviewer-rules.ts';

export type { ReviewDiff } from './reviewer-rules.ts';

/** Pure version-1 selection. Include never definitions (the execution resolver intentionally filters them out). */
export function selectReviewers(settings: unknown, diff: ReviewDiff) {
    const parsed = parseFactorySettings(settings);
    const orderedDiff = {
        ...diff,
        files: [...diff.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    };

    return [...parsed.reviewers]
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .map((reviewer) => {
            const { mode } = reviewer;
            const match =
                mode.kind === 'on-trigger'
                    ? matchReviewerTrigger(mode.trigger, orderedDiff)
                    : {
                          outcome: mode.kind === 'never' ? ('unmatched' as const) : ('matched' as const),
                          rule: `mode.${mode.kind}`,
                          evidence: `Saved mode is ${mode.kind}.`,
                      };
            const run = mode.kind !== 'never' && match.outcome !== 'unmatched';

            return {
                id: reviewer.id,
                name: reviewer.name,
                mode,
                run,
                reason: `${match.outcome}: ${match.rule}: ${match.evidence}`,
                triggerVersion: 1 as const,
                ...match,
                instructions: reviewerInstructions(reviewer),
            };
        });
}
