import type { Item } from './item-domain.ts';
import { openQuestionThread, ownerThread, type ItemThread } from './thread-domain.ts';

/** The next action names the pending request and opens its exact owner, including a child thread. */
export function questionThreadAction(thread: ItemThread | undefined) {
    const request = thread?.pendingRequest;

    return {
        kind: 'thread' as const,
        label: request?.kind === 'brief-approval' ? 'Approve brief' : thread ? 'Answer in T3' : 'Open thread',
        threadId: request?.threadId ?? thread?.id,
    };
}

/** An unstarted part may use its nearest concept or linked parent's current threads without inheriting their association or usage. */
export function questionOwnerParent(item: Item, all: readonly Item[]): Item | undefined {
    if (item.status !== 'Needs you' || item.threads === 'unavailable' || item.threads?.length) return undefined;

    const seen = new Set([item.id]);
    let parentId = item.parentId;

    while (parentId && !seen.has(parentId)) {
        seen.add(parentId);

        const parent = all.find((candidate) => candidate.id === parentId);

        if (!parent) return undefined;

        if (parent.kind === 'concept' || (parent.kind !== 'decision' && parent.flow === 'linked')) {
            if (!Array.isArray(parent.threads) || parent.threads.some((thread) => thread.observedAt)) return undefined;

            return parent;
        }

        parentId = parent.parentId;
    }

    return undefined;
}

/** A shaping owner may ask for a sibling build's gate; the exact digest identifies that approval. */
export function delegatedBriefApproval(owner: Item, all: readonly Item[]): Item | undefined {
    const request = openQuestionThread(owner);
    const summary = request?.questionSummary;

    if (
        !request?.pendingRequest ||
        request.pendingRequest.kind === 'tool-approval' ||
        !summary ||
        !/approv/i.test(summary.split('\n')[0] ?? '')
    )
        return undefined;

    return all.find(
        (candidate) =>
            candidate.id !== owner.id &&
            candidate.status !== 'Done' &&
            !!candidate.briefApproval?.digest &&
            summary.includes(candidate.briefApproval.digest) &&
            (candidate.parentId === owner.id || (!!owner.parentId && candidate.parentId === owner.parentId)),
    );
}

/** Navigation to the nearest shaping owner, including a finished decision or concept. It confers no activity or usage. */
export function shapingOwner(item: Item, all: readonly Item[]): Item | undefined {
    if (item.threads === 'unavailable' || item.threads?.length) return undefined;

    const seen = new Set([item.id]);
    let parentId = item.parentId;

    while (parentId && !seen.has(parentId)) {
        seen.add(parentId);

        const parent = all.find((candidate) => candidate.id === parentId);

        if (!parent) return undefined;

        if (['concept', 'decision'].includes(parent.kind) && ownerThread(parent)) return parent;

        parentId = parent.parentId;
    }

    return undefined;
}

/** One group approval action owns every displayed member; unfinished Doubt remains an agent wait. */
export function pendingBriefBatch(parent: Item, all: readonly Item[]): Item[] {
    if (
        parent.setAside ||
        parent.status === 'Done' ||
        parent.parentId ||
        (parent.kind !== 'concept' && parent.flow !== 'linked')
    )
        return [];

    const parts = all.filter(
        (part) =>
            part.parentId === parent.id &&
            !part.setAside &&
            part.status !== 'Done' &&
            !['concept', 'decision', 'slice'].includes(part.kind) &&
            part.passingBrief === false &&
            !part.briefChangesRequested,
    );
    const requested =
        /approve.*brief|brief.*approval/i.test(parent.needsYou?.reason ?? '') ||
        parts.some((part) => part.briefApproval);

    return requested && parts.length && !parts.some((part) => part.briefReviewing) ? parts : [];
}
