import { isRecord } from '@lar-factory/shared';
import { parseFactorySettings, reviewerInstructions } from '@lar-factory/shared/factory-settings';

import { parseReviewEscalation, type ReviewEscalation } from './reviewer-escalation.ts';
import { matchReviewerTrigger, type ReviewDiff } from './reviewer-rules.ts';

export type { ReviewDiff } from './reviewer-rules.ts';

/** Pure version-1 selection. Include never definitions (the execution resolver intentionally filters them out). */
export function selectReviewers(settings: unknown, diff: ReviewDiff, escalations: unknown = []) {
    const parsed = parseFactorySettings(settings);
    const orderedDiff = {
        ...diff,
        files: [...diff.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    };

    const selected = [...parsed.reviewers]
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
                escalation: undefined as ReviewEscalation | undefined,
            };
        });

    if (!Array.isArray(escalations)) throw new Error('Escalations must be a list.');

    for (const request of escalations) {
        const escalation = parseReviewEscalation(request);
        const target = isRecord(request) && selected.find((reviewer) => reviewer.id === request.reviewer);

        if (!target) throw new Error('An escalation must name a configured reviewer.');

        if (!selected.some((reviewer) => reviewer.id === escalation.requestedBy && reviewer.run))
            throw new Error('Only the selected Code reviewer can escalate.');

        // Never wins; an existing selection (including an earlier request) never adds a second run.
        if (target.mode.kind === 'never' || target.run) continue;

        target.run = true;
        target.escalation = escalation;
        target.reason = `Escalated by ${escalation.requestedBy}: ${escalation.reason}`;
    }

    return selected;
}
