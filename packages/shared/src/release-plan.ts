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

/** Release steps and receipts name the human role `User`; records saved before the rename use a legacy name. */
export const HUMAN_ROLE = 'User';

const LEGACY_HUMAN_ROLE = 'Pedro';

/** True for a human step's `who` or a human receipt's `by`, including legacy saved records. */
export const isHumanRole = (who: string | null | undefined): boolean => {
    const name = who?.trim().toLowerCase();

    return name === HUMAN_ROLE.toLowerCase() || name === LEGACY_HUMAN_ROLE.toLowerCase();
};

/** Regex source for the human role in saved notice text, as written now or before the rename. */
export const HUMAN_ROLE_TEXT = `(?:the user|user|${LEGACY_HUMAN_ROLE})`;

/** The user's release receipts can only be submitted by the board. */
export const isUserReleaseStep = (step: ReleasePlan['steps'][number]): boolean => isHumanRole(step.who);

/** Release order makes only the first unfinished step actionable. */
export function pendingUserReleaseStep(plan: ReleasePlan | null | undefined) {
    const step = plan?.steps.find((step) => !step.done);

    return step && isUserReleaseStep(step) ? step : undefined;
}

/** A group's user release step waits on the user only once none of its parts is still being built. */
export function dueUserReleaseStep(item: Item, all: readonly Item[]) {
    const building = all.some(
        (part) => part.parentId === item.id && !part.setAside && part.status !== 'Done' && !part.completion?.complete,
    );

    return building ? undefined : pendingUserReleaseStep(item.releasePlan);
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
    fixProposal?: {
        requestedAt: string;
        commandId: string;
        messageId: string;
        threadId: string;
        sent: boolean;
        error: string | null;
        rejected?: boolean;
    };
}

/** A missing owner, failed check, failed dispatch or owner that ended without evidence returns to the user. */
export function outcomeNeedsUser(item: Item, all: readonly Item[] = []): boolean {
    if (!item.outcomeCheck?.ready) return false;

    const run = item.outcomeCheck.run;

    const failed = item.releasePlan?.outcomeCheck.result === 'failed';
    const fix = run?.fixProposal;

    if (failed && (!fix?.sent || fix.error)) return true;

    if (!run || (!failed && run.error)) return true;

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
        Date.parse(thread.updated) >= Date.parse(failed && fix ? fix.requestedAt : run.requestedAt)
    );
}
