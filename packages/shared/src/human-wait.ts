import { dependencyProofs, deskWait } from './desk-wait.ts';
import type { Item } from './item-domain.ts';
import { deliveryPrStatus, prReadiness } from './presentation.ts';
import { delegatedBriefApproval, pendingBriefBatch } from './question-thread.ts';
import { releaseNeedsUser, supersededReleaseQuestion } from './release-continuation.ts';
import { dueUserReleaseStep, outcomeNeedsUser } from './release-plan.ts';
import { retroWaits } from './retro.ts';
import { openQuestionThread, stoppedRunThread, workingAgain } from './thread-domain.ts';

/** The same human wait determines desk placement and group attention. */
export function humanWait(item: Item, unavailable = false, all: readonly Item[] = []) {
    if (item.ticketEditHeld || dependencyProofs(item).length) return deskWait(item, unavailable, all);

    const parent = all.find((candidate) => candidate.id === item.parentId);
    const question = openQuestionThread(item);

    if (
        parent &&
        pendingBriefBatch(parent, all).some((part) => part.id === item.id) &&
        (!question || question.pendingRequest?.kind === 'brief-approval') &&
        (!item.needsYou || item.needsYou.reason === item.briefApproval?.reason)
    )
        return null;

    if (pendingBriefBatch(item, all).length) return deskWait(item, unavailable, all);

    if (item.briefReviewing && !item.needsYou && (!question || question.pendingRequest?.kind === 'brief-approval'))
        return null;

    if (
        !item.briefApproval &&
        !item.needsYou &&
        !retroWaits(item.retro) &&
        !dueUserReleaseStep(item, all) &&
        delegatedBriefApproval(item, all)
    )
        return null;

    const pr = item.linkedPrs?.[0];
    const observedReview = item.verification?.prReview && pr?.state === 'open' && pr.review;
    const delivery = deliveryPrStatus(item, unavailable);
    const reviewWait =
        delivery &&
        !delivery.running &&
        (delivery.feedback || delivery.handback || (pr?.review?.required === 'green' && pr.mergeState !== 'conflicts'));

    const automaticRepair =
        item.verification?.prReview &&
        pr?.state === 'open' &&
        ((pr.review ? pr.review.required === 'failed' : !!pr.checks?.failed && pr.mergeState !== 'can merge') ||
            pr.mergeState === 'conflicts');
    const waiting =
        reviewWait ||
        releaseNeedsUser(item, all) ||
        (item.status !== 'Done' &&
            Array.isArray(item.threads) &&
            item.threads.some((thread) => !thread.observedAt && supersededReleaseQuestion(item, thread))) ||
        outcomeNeedsUser(item, all) ||
        retroWaits(item.retro) ||
        !!dueUserReleaseStep(item, all) ||
        !!item.briefApproval ||
        item.status === 'Needs you' ||
        (item.status !== 'Done' && !!openQuestionThread(item)) ||
        (!unavailable && !!stoppedRunThread(item)) ||
        !!item.needsYou ||
        (item.status !== 'Done' &&
            Array.isArray(item.threads) &&
            item.threads.some((thread) => thread.childNeedsYou && !thread.observedAt)) ||
        (!observedReview &&
            (!pr || pr.state === 'open') &&
            (item.status === 'Verify' || item.status === 'Ready to merge') &&
            !automaticRepair &&
            !workingAgain(item, unavailable) &&
            (item.verification?.prReview || prReadiness(item)?.state !== 'active'));

    return waiting ? deskWait(item, unavailable, all) : null;
}
