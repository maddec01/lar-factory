import type { Item } from './item-domain.ts';
import { nextAction } from './item-next-action.ts';
import { canResumeShaping, canRetryBuild, openQuestionThread, stoppedRunThread } from './thread-domain.ts';

/** The desk names the human wait independently of the recorded workflow stage. */
export function deskWait(item: Item, unavailable = false, all: readonly Item[] = []) {
    const question = unavailable ? undefined : (openQuestionThread(item) ?? inheritedQuestion(item, all));
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
            action: {
                kind: 'thread' as const,
                label:
                    request?.kind === 'brief-approval'
                        ? 'Approve brief'
                        : request?.kind === 'tool-approval'
                          ? 'Resolve approval'
                          : 'Answer in T3',
                threadId: request?.threadId ?? question.id,
            },
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

/** An unstarted part's saved question can be held in its nearest concept. */
function inheritedQuestion(item: Item, all: readonly Item[]) {
    if (item.status !== 'Needs you' || item.threads === 'unavailable' || item.threads?.length) return undefined;

    const seen = new Set([item.id]);
    let parentId = item.parentId;

    while (parentId && !seen.has(parentId)) {
        seen.add(parentId);

        const parent = all.find((candidate) => candidate.id === parentId);

        if (!parent) return undefined;

        if (parent.kind === 'concept') {
            if (!Array.isArray(parent.threads) || parent.threads.some((thread) => thread.observedAt)) return undefined;

            return openQuestionThread(parent);
        }

        parentId = parent.parentId;
    }

    return undefined;
}

/** A gate's full brief belongs in the Brief section and T3, not a flattened wait notice. */
export function questionWaitReason(item: Item): string {
    const thread = openQuestionThread(item);

    return thread?.pendingRequest?.kind === 'brief-approval'
        ? 'Review the brief below, then approve it or request changes in T3.'
        : thread?.questionSummary ||
              'This work is waiting for your answer or decision. Open the thread in T3 to continue.';
}
