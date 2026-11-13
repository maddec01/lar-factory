import type { Item } from './item-domain.ts';
import type { ItemThread } from './thread-domain.ts';

/** The next action names the pending request and opens its exact owner, including a child thread. */
export function questionThreadAction(thread: ItemThread | undefined) {
    const request = thread?.pendingRequest;

    return {
        kind: 'thread' as const,
        label:
            request?.kind === 'tool-approval'
                ? 'Resolve approval'
                : request?.kind === 'brief-approval'
                  ? 'Approve brief'
                  : thread
                    ? 'Answer in T3'
                    : 'Open thread',
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
