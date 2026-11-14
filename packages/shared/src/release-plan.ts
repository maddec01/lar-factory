import type { Item } from './item-domain.ts';
import { isLiveThread } from './thread-domain.ts';

/** Local delivery evidence for a concept or linked-work parent. Step order is execution order. */
export interface ReleaseEvidence {
    by: string;
    evidence: string;
    at: string;
}
export interface ReleasePlan {
    steps: { id: string; who: string; what: string; done: ReleaseEvidence | null; shipsWith?: string[] }[];
    outcomeCheck: { what: string; result: 'pending' | 'passed' | 'failed'; evidence: ReleaseEvidence | null };
}

export function releaseHolds(plan: ReleasePlan | null | undefined): string[] {
    if (!plan) return [];

    return [
        ...plan.steps
            .filter((step) => !step.done)
            .map((step) => `Release step ${step.id}: ${step.who} must ${step.what}`),
        ...(plan.outcomeCheck.result !== 'passed'
            ? [`Outcome check ${plan.outcomeCheck.result}: ${plan.outcomeCheck.what}`]
            : []),
    ];
}

/** Pedro's release receipts can only be submitted by the board. */
export const isPedroReleaseStep = (step: ReleasePlan['steps'][number]): boolean =>
    step.who.trim().toLowerCase() === 'pedro';

/** Release order makes only the first unfinished step actionable. */
export function pendingPedroReleaseStep(plan: ReleasePlan | null | undefined) {
    const step = plan?.steps.find((step) => !step.done);

    return step && isPedroReleaseStep(step) ? step : undefined;
}

/** Stored before dispatch; retries after a lost response reuse both T3 identities. */
export interface OutcomeCheckRun {
    digest: string;
    ownerWorkId: string;
    threadId: string;
    commandId: string;
    messageId: string;
    requestedAt: string;
    sent: boolean;
    error: string | null;
    rejected?: boolean;
}

/** A missing owner, failed check, failed dispatch or owner that ended without evidence returns to Pedro. */
export function outcomeNeedsPedro(item: Item, all: readonly Item[] = []): boolean {
    if (!item.outcomeCheck?.ready) return false;

    const run = item.outcomeCheck.run;

    if (!run || run.error || item.releasePlan?.outcomeCheck.result === 'failed') return true;

    const owner = all.find((candidate) => candidate.id === run.ownerWorkId);
    const thread = Array.isArray(owner?.threads)
        ? owner.threads.find((thread) => thread.id === run.threadId)
        : undefined;

    if (!owner || (Array.isArray(owner.threads) && !thread)) return true;

    return (
        !!thread &&
        !isLiveThread(thread) &&
        !thread.hasRunningChildren &&
        !thread.observedAt &&
        ['done', 'stopped'].includes(thread.state ?? '') &&
        !!thread.updated &&
        Date.parse(thread.updated) >= Date.parse(run.requestedAt)
    );
}
