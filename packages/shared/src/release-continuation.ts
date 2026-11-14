import type { Item } from './item-domain.ts';
import { isPedroReleaseStep, pendingPedroReleaseStep, type ReleasePlan } from './release-plan.ts';
import type { ItemThread } from './thread-domain.ts';

/** Recognize an approval of a recorded release operation, never a scope question or tool permission. */
export function releaseApprovalStep(plan: ReleasePlan | null | undefined, question: string | undefined) {
    if (!question || !/\bapprove\b|\b(?:activation|release|deployment) approval\b/i.test(question)) return undefined;

    const words = (text: string) =>
        text.toLowerCase().match(/activat\w*|deploy\w*|releas\w*|publish\w*|manifest/g) ?? [];
    const operations = words(question).map((word) => word.slice(0, 6));
    const asksApproval = /(?:^|[?:]\s*|\bplease\s+)approve\b|\b(?:activation|release|deployment) approval\b/i.test(
        question,
    );

    return asksApproval
        ? plan?.steps.find(
              (step) =>
                  isPedroReleaseStep(step) &&
                  (!step.done ||
                      (question.match(/\b[a-f0-9]{40,64}\b/gi) ?? []).every((pin) =>
                          step.done!.evidence.toLowerCase().includes(pin.toLowerCase()),
                      )) &&
                  words(step.what).some((word) => operations.includes(word.slice(0, 6))),
          )
        : undefined;
}

export function supersededReleaseQuestion(item: Item, thread: ItemThread | undefined): boolean {
    return (
        !!thread?.pendingRequest &&
        thread.pendingRequest.kind !== 'tool-approval' &&
        (thread.pendingRequest.questions ?? [thread.questionSummary]).every(
            (question) => !!releaseApprovalStep(item.releasePlan, question),
        )
    );
}

/** Delivery parents continue their existing owner even when their stored status still says Shaping. */
export function releaseContinuationReady(item: Item, all: readonly Item[]): boolean {
    const parts = all.filter((part) => part.parentId === item.id && !part.setAside);

    return (
        !item.setAside &&
        item.status !== 'Done' &&
        !!item.releasePlan &&
        (item.kind === 'concept' || item.flow === 'linked') &&
        (item.releaseContinuation?.ready ??
            (parts.some((part) => part.kind === 'build') &&
                parts.every((part) => part.status === 'Done' || part.completion?.complete))) &&
        !pendingPedroReleaseStep(item.releasePlan) &&
        (item.releasePlan.steps.some((step) => !step.done) || item.releasePlan.outcomeCheck.result !== 'passed')
    );
}

/** Failed delivery or an owner ending without its next receipt needs a board retry. */
export function releaseNeedsPedro(item: Item, all: readonly Item[]): boolean {
    if (!item.releaseContinuation?.ready) return false;

    const run = item.releaseContinuation.run;

    if (!run || run.error) return true;

    const owner = all.find((candidate) => candidate.id === run.ownerWorkId);
    const thread = Array.isArray(owner?.threads)
        ? owner.threads.find((thread) => thread.id === run.threadId)
        : undefined;

    return (
        !!thread &&
        !thread.observedAt &&
        !thread.currentRunning &&
        !thread.hasRunningChildren &&
        !thread.hasLiveChildren &&
        !thread.queued &&
        ['done', 'stopped'].includes(thread.state) &&
        Date.parse(thread.updated) >= Date.parse(run.requestedAt)
    );
}
