import type { Blocker, Item } from './model.ts';
import { blockedText, blockerRef } from './presentation.ts';

export interface WorkMapPart {
    item: Item;
    status: Item['status'];
    queued: boolean;
    gate: 'passed' | 'not passed' | 'unknown' | 'not applicable';
    waits: string[];
}

export interface WorkMapPrerequisite {
    id: string;
    kind: 'blocker' | 'dependency';
    title: string;
    blocker: Blocker;
}

export interface WorkMapEdge {
    from: string;
    to: string;
    kind: 'blocker' | 'dependency';
}

/** A fresh projection of a group's records. Text and ticket numbers on Dependencies never imply work edges. */
export function projectWorkMap(items: readonly Item[], parentId?: string) {
    const parts = parentId === undefined ? items : items.filter((item) => item.parentId === parentId);
    const byId = new Map(parts.map((item) => [item.id, item]));
    const byTicket = new Map(
        parts.filter((item) => item.number).map((item) => [`${item.repo.toLowerCase()}#${item.number}`, item]),
    );
    const prerequisites = new Map<string, WorkMapPrerequisite>();
    const edges = new Map<string, WorkMapEdge>();
    const nodes: WorkMapPart[] = parts.map((item) => {
        for (const blocker of item.blockers) {
            const dependency = blocker.dependency;
            const internal = dependency
                ? undefined
                : blocker.workId
                  ? byId.get(blocker.workId)
                  : byTicket.get(`${blocker.repo.toLowerCase()}#${blocker.number}`);
            const kind = dependency ? 'dependency' : 'blocker';
            const from =
                internal?.id ??
                `${kind}:${dependency?.dependencyId ?? blocker.workId ?? `${blocker.repo.toLowerCase()}#${blocker.number}`}`;

            if (!internal)
                prerequisites.set(from, {
                    id: from,
                    kind,
                    title: dependency
                        ? `${dependency.owner}: ${dependency.need}`
                        : blocker.title || blockerRef(item, blocker),
                    blocker,
                });

            edges.set(`${kind}:${from}:${item.id}`, { from, to: item.id, kind });
        }

        const gate =
            item.kind === 'decision' || item.kind === 'concept'
                ? 'not applicable'
                : item.passingBrief === undefined
                  ? 'unknown'
                  : item.passingBrief
                    ? 'passed'
                    : 'not passed';
        const blocked = blockedText(item);

        return {
            item,
            status: item.status,
            queued: item.status !== 'List',
            gate,
            waits: [
                ...(item.paused ? [item.paused] : []),
                ...(item.needsYou ? [item.needsYou.reason] : []),
                ...(blocked ? [blocked] : []),
                ...(gate === 'not passed' ? ['Brief gate has not passed'] : []),
                ...(item.status === 'List' ? ['Not queued'] : []),
            ],
        };
    });

    return { nodes, prerequisites: [...prerequisites.values()], edges: [...edges.values()] };
}
