import { isRecord } from '@lar-factory/shared';
import type { FactorySettings } from '@lar-factory/shared/factory-settings';

import { WorkRecordError } from './database.ts';

export interface ReviewEscalation {
    requestedBy: 'code';
    reason: string;
}

/** Model output is data: only the selected Code reviewer can request another reviewer. */
export function parseReviewEscalation(value: unknown): ReviewEscalation {
    if (!isRecord(value) || value.requestedBy !== 'code' || typeof value.reason !== 'string' || !value.reason.trim())
        throw new WorkRecordError('invalid', 'An escalation needs requestedBy code and a nonempty reason.');

    return { requestedBy: 'code', reason: value.reason };
}

/** Recheck saved never policies at the durable record boundary as well as before launching. */
export function checkRecordedEscalation(
    value: unknown,
    axis: string,
    reviewers: readonly { axis: string; verdict: string }[],
    settings: FactorySettings,
): ReviewEscalation {
    const escalation = parseReviewEscalation(value);

    if (
        axis === 'code' ||
        !reviewers.some((reviewer) => reviewer.axis === 'code' && reviewer.verdict !== 'skipped') ||
        !reviewers.some((reviewer) => reviewer.axis === axis && reviewer.verdict !== 'skipped')
    )
        throw new WorkRecordError('invalid', 'An escalation needs results from Code and the requested reviewer.');

    for (const id of ['code', axis]) {
        if (settings.reviewers.find((reviewer) => reviewer.id === id)?.mode.kind === 'never')
            throw new WorkRecordError('invalid', `The ${id} reviewer is set to never; escalation is refused.`);
    }

    return escalation;
}
