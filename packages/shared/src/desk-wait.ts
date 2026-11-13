import type { Item } from './item-domain.ts';
import { nextAction } from './item-next-action.ts';
import { questionOwnerConcept, questionThreadAction } from './question-thread.ts';
import { canResumeShaping, canRetryBuild, openQuestionThread, stoppedRunThread } from './thread-domain.ts';

/** The desk names the human wait independently of the recorded workflow stage. */
export function deskWait(item: Item, unavailable = false, all: readonly Item[] = []) {
    if (item.briefApproval)
        return { label: 'Approve brief', action: { kind: 'details' as const, label: 'Approve brief' } };

    const concept = unavailable ? undefined : questionOwnerConcept(item, all);
    const question = unavailable ? undefined : (openQuestionThread(item) ?? (concept && openQuestionThread(concept)));
    const request = question?.pendingRequest;
    const stopped = !unavailable && stoppedRunThread(item);

    if (question)
        return {
            label:
                request?.kind === 'brief-approval'
                    ? 'Approve brief'
                    : request?.kind === 'tool-approval'
                      ? 'Tool approval'
                      : 'Question',
            action: questionThreadAction(question),
        };

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
    if (item.briefApproval) return item.briefApproval.reason;

    const thread = openQuestionThread(item);

    return thread?.pendingRequest?.kind === 'brief-approval'
        ? 'Review the brief below, then approve it or request changes in T3.'
        : thread?.questionSummary ||
              'This work is waiting for your answer or decision. Open the thread in T3 to continue.';
}
