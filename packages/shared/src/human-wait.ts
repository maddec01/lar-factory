import { deskWait } from './desk-wait.ts';
import type { Item } from './item-domain.ts';
import { prReadiness } from './presentation.ts';
import { delegatedBriefApproval, pendingBriefBatch } from './question-thread.ts';
import { outcomeNeedsPedro, pendingPedroReleaseStep } from './release-plan.ts';
import { retroWaits } from './retro.ts';
import { openQuestionThread, stoppedRunThread, workingAgain } from './thread-domain.ts';

/** The same human wait determines desk placement and group attention. */
export function humanWait(item: Item, unavailable = false, all: readonly Item[] = []) {
    const parent = all.find((candidate) => candidate.id === item.parentId);
    const question = openQuestionThread(item);

    if (
        parent &&
        pendingBriefBatch(parent, all).some((part) => part.id === item.id) &&
        (!question || question.pendingRequest?.kind === 'brief-approval') &&
        (!item.needsYou ||
            item.needsYou.reason === item.briefApproval?.reason ||
            /approve.*brief|brief.*approval/i.test(item.needsYou.reason))
    )
        return null;

    if (pendingBriefBatch(item, all).length) return deskWait(item, unavailable, all);

    if (item.briefReviewing && !item.needsYou && (!question || question.pendingRequest?.kind === 'brief-approval'))
        return null;

    if (
        !item.briefApproval &&
        !retroWaits(item.retro) &&
        !pendingPedroReleaseStep(item.releasePlan) &&
        delegatedBriefApproval(item, all)
    )
        return null;

    const waiting =
        outcomeNeedsPedro(item, all) ||
        retroWaits(item.retro) ||
        !!pendingPedroReleaseStep(item.releasePlan) ||
        !!item.briefApproval ||
        item.status === 'Needs you' ||
        (item.status !== 'Done' && !!openQuestionThread(item)) ||
        (!unavailable && !!stoppedRunThread(item)) ||
        !!item.needsYou ||
        (item.status !== 'Done' &&
            Array.isArray(item.threads) &&
            item.threads.some((thread) => thread.childNeedsYou && !thread.observedAt)) ||
        ((item.status === 'Verify' || item.status === 'Ready to merge') &&
            !workingAgain(item, unavailable) &&
            prReadiness(item)?.state !== 'active');

    return waiting ? deskWait(item, unavailable, all) : null;
}
