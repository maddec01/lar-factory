import type { Item } from './item-domain.ts';
import { nextAction } from './item-next-action.ts';
import { pendingBriefBatch, questionOwnerParent, questionThreadAction } from './question-thread.ts';
import { releaseContinuationReady, supersededReleaseQuestion } from './release-continuation.ts';
import { outcomeNeedsPedro, pendingPedroReleaseStep } from './release-plan.ts';
import { retroWaits } from './retro.ts';
import { canResumeShaping, canRetryBuild, openQuestionThread, stoppedRunThread } from './thread-domain.ts';

/** Closure alone is insufficient: evidence must be available for Pedro to inspect and accept. */
export const dependencyProofs = (item: Item) =>
    item.status === 'Done' || item.setAside
        ? []
        : (item.blockers ?? []).flatMap((blocker) => {
              const d = blocker.dependency;

              return d &&
                  !d.met &&
                  d.evidence.trim() &&
                  ((!d.ticket && !d.named.length) || ['closed', 'merged'].includes(d.observation?.kind ?? ''))
                  ? [d]
                  : [];
          });

/** The desk names the human wait independently of the recorded workflow stage. */
export function deskWait(item: Item, unavailable = false, all: readonly Item[] = []) {
    if (item.ticketEditHeld)
        return { label: 'Ticket edit', action: { kind: 'details' as const, label: 'Review ticket edit' } };

    if (dependencyProofs(item).length)
        return {
            label: 'Accept dependency proof',
            action: { kind: 'details' as const, label: 'Accept dependency proof' },
        };

    if (outcomeNeedsPedro(item, all))
        return { label: 'Outcome check', action: { kind: 'details' as const, label: 'Record Outcome' } };

    if (pendingBriefBatch(item, all).length)
        return { label: 'Approve briefs', action: { kind: 'details' as const, label: 'Approve briefs' } };

    const parent = all.find((candidate) => candidate.id === item.parentId);
    const inBatch = parent && pendingBriefBatch(parent, all).some((part) => part.id === item.id);

    if (item.briefApproval && !inBatch)
        return { label: 'Approve brief', action: { kind: 'details' as const, label: 'Approve brief' } };

    if (retroWaits(item.retro))
        return { label: 'Choose follow-ups', action: { kind: 'details' as const, label: 'Choose follow-ups' } };

    if (pendingPedroReleaseStep(item.releasePlan))
        return { label: 'Release step', action: { kind: 'details' as const, label: 'Mark release step done' } };

    const concept = unavailable ? undefined : questionOwnerParent(item, all);
    const question = unavailable ? undefined : (openQuestionThread(item) ?? (concept && openQuestionThread(concept)));
    const request = question?.pendingRequest;
    const stopped = !unavailable && stoppedRunThread(item);

    if (question)
        return {
            label:
                request?.kind === 'brief-approval'
                    ? 'Approve brief'
                    : request?.kind === 'tool-approval'
                      ? 'Approval in T3'
                      : 'Question',
            action: questionThreadAction(question),
        };

    if (releaseContinuationReady(item, all))
        return { label: 'Release', action: { kind: 'details' as const, label: 'Resume release' } };

    if (stopped)
        return {
            label: 'Run stopped',
            action: canRetryBuild(item)
                ? { kind: 'retry-build' as const, label: 'Retry start' }
                : canResumeShaping(item)
                  ? { kind: 'resume-shaping' as const, label: 'Resume shaping' }
                  : { kind: 'thread' as const, label: 'Resume in T3', threadId: stopped.id },
        };

    if (item.needsYou?.offers.includes('start-again'))
        return { label: 'Start failed', action: { kind: 'start-again' as const, label: 'Start again' } };

    if (item.status === 'Verify') return { label: 'Verify build', action: nextAction(item) };

    if (item.status === 'Ready to merge') return { label: 'Merge PR', action: nextAction(item) };

    if (item.needsYou)
        return { label: 'Decision needed', action: { kind: 'details' as const, label: 'Review notice' } };

    return {
        label:
            item.status === 'Needs you' ||
            (Array.isArray(item.threads) && item.threads.some((thread) => thread.childNeedsYou && !thread.observedAt))
                ? 'Question'
                : 'Needs you',
        action: nextAction(item),
    };
}

/** A gate's full brief belongs in the Brief section and T3, not a flattened wait notice. */
export function questionWaitReason(item: Item): string {
    if (Array.isArray(item.threads) && item.threads.some((thread) => supersededReleaseQuestion(item, thread)))
        return 'The duplicate T3 approval question is superseded by the board release step. Continue through the board.';

    if (item.briefApproval) return item.briefApproval.reason;

    const thread = openQuestionThread(item);

    return thread?.pendingRequest?.kind === 'brief-approval'
        ? 'Review the brief below, then approve it or request changes in T3.'
        : thread?.questionSummary ||
              'This work is waiting for your answer or decision. Open the thread in T3 to continue.';
}
