import { humanWait } from './human-wait.ts';
import type { Item } from './item-domain.ts';

export interface FogOwner {
    id: string;
    kind: string;
    decisionMethod?: string | undefined;
    complete: boolean;
    active: boolean;
    question: boolean;
}

/** Map narrative names routes; live records prove that each route still exists. */
export function conceptFog(fog: readonly string[], owners: readonly FogOwner[]) {
    return fog.map((text) => {
        const match = /^\[(factory|decision|question):\s*([^\]\s]+)\]\s+(.+)$/.exec(text);
        const owner = match && owners.find((o) => o.id === match[2] && !o.complete);
        const routed = Boolean(
            owner &&
            (match![1] === 'decision'
                ? owner.kind === 'decision'
                : match![1] === 'question'
                  ? owner.question
                  : owner.kind === 'decision' && owner.decisionMethod === 'task' && owner.active),
        );

        return { text, question: match?.[3] ?? text, routed };
    });
}

/** The board counts the same routes as reconciliation, with T3's current question evidence. */
export function itemFog(parent: Item, all: readonly Item[], unavailable = false) {
    return conceptFog(
        parent.map?.fog ?? [],
        all
            .filter((i) => i.id === parent.id || i.parentId === parent.id)
            .map((i) => ({
                id: i.id,
                kind: i.kind,
                decisionMethod: i.decisionMethod ?? undefined,
                complete: Boolean(i.setAside || (i.completion?.complete ?? i.status === 'Done')),
                active: i.status === 'Shaping' && !humanWait(i, unavailable, all),
                question: humanWait(i, unavailable, all)?.label === 'Question' || Boolean(i.needsYou),
            })),
    );
}
