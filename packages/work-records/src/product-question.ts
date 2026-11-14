import { releaseApprovalStep } from '@lar-factory/shared';

import { WorkRecordError } from './database.ts';
import type { WorkRecords } from './work-records.ts';

/** Product questions belong on the desk; delivery ordering belongs in the blocker graph. */
export function requireProductQuestion(records: WorkRecords, workId: string, reason: string): void {
    if (
        /role-finish|completed role execution is immutable|abandoned execution|bookkeeping|reconciliation.*(?:failed|failure|conflict)/i.test(
            reason,
        )
    )
        throw new WorkRecordError(
            'invalid',
            'Technical role bookkeeping is an agent/system hold. Resolve its execution evidence; do not set Needs you.',
        );

    const plan = records.releasePlan(workId);
    const pedroSteps = plan?.steps.filter((step) => step.who.trim().toLowerCase() === 'pedro');
    const represented = pedroSteps?.find((step) => !step.done) ?? pedroSteps?.at(-1);
    const step =
        plan?.steps.find((step) => reason.startsWith(`Release step ${step.id} awaits Pedro in the board.`)) ??
        releaseApprovalStep(plan, reason) ??
        (/^No Pedro (?:activation|release|deployment) receipt is recorded\.$/i.test(reason) ? represented : undefined);

    if (step)
        throw new WorkRecordError(
            'invalid',
            `Use the board release step ${step.id}; it already represents this action. Do not save an independent Needs you notice.`,
        );

    // Free-text reasons such as "Approve the brief." do not identify a board action.
    // Require both an explicit board reference and a request, not a passing mention.
    const namesBoardAction =
        /\b(?:in|on|through|via|using) (?:the )?board\b|\bboard(?:-only)? (?:button|control|action)\b/i.test(reason);
    const boardAction =
        namesBoardAction &&
        /(?:^|[.!?]\s+)(?:please\s+)?(?:approve (?:the |this )?(?:(?:revised|amended|current|final|exact|proposed|updated) )?(?:briefs?|gate|batch)|merge (?:the |this )?PR|(?:wait(?:ing)? (?:for|on)|awaiting|pending) (?:Pedro(?:'s)? (?:to )?)?(?:brief approval|brief gate|gate approval|Verify|Outcome|merge|release approval|release step|activation approval)|(?:mark|record|complete) (?:the |this )?(?:Verify|Outcome|release step)|Verify (?:this|the) head|(?:(?:revised|amended|current|final) )?brief (?:needs|awaits|requires) approval)\b/i.test(
            reason,
        );

    if (boardAction)
        throw new WorkRecordError(
            'invalid',
            represented && /\b(?:release|activation|manifest)\b/i.test(reason)
                ? `Use the board release step ${represented.id}; do not save an independent Needs you notice.`
                : 'Use the board action for gates, Verify, Outcome or merge; do not save an independent Needs you notice.',
        );

    if (
        !/\b(wait(?:ing)?|blocked|until|pending)\b/i.test(reason) ||
        !/\b(gate|approval|merge[ds]?|ready|done|finish(?:ed)?|complet(?:e|ed|ion)|state)\b/i.test(reason)
    )
        return;

    const namesWork = (name: string | null) => {
        if (!name) return false;

        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, name.length <= 2 ? 'u' : 'iu').test(
            reason,
        );
    };
    const other = records
        .list({})
        .find(
            (record) =>
                record.workId !== workId &&
                [record.workId, record.title, record.ticket, ...(record.title.match(/\b[A-Z]{2,3}\b/g) ?? [])].some(
                    namesWork,
                ),
        );

    if (other || /another (?:work )?item|other (?:work )?item/i.test(reason))
        throw new WorkRecordError(
            'invalid',
            'Waiting on another work item is an agent wait. Use add-blocker (or sync-blockers from brief declarations), then waiting-on; do not set Needs you.',
        );
}
