import type { DatabaseSync } from 'node:sqlite';

import { WorkRecordError } from './database.ts';

type Edge = { work_id: string; blocker_id: string };

const readEdges = (db: DatabaseSync) =>
    db.prepare('SELECT work_id, blocker_id FROM blockers ORDER BY rowid').all() as Edge[];

function router(edges: readonly Edge[]) {
    const graph = new Map<string, string[]>();

    for (const edge of edges) {
        const next = graph.get(edge.work_id) ?? [];

        next.push(edge.blocker_id);
        graph.set(edge.work_id, next);
    }

    const path = (start: string, end: string, omitted?: Edge): string[] | null => {
        const queue = [[start]];
        const visited = new Set([start]);

        for (const route of queue) {
            const last = route.at(-1)!;

            for (const next of graph.get(last) ?? []) {
                if (omitted?.work_id === last && omitted.blocker_id === next) continue;

                if (next === end) return [...route, next];

                if (!visited.has(next)) {
                    visited.add(next);
                    queue.push([...route, next]);
                }
            }
        }

        return null;
    };
    const drop = (edge: Edge) => {
        const next = graph.get(edge.work_id)!;

        next.splice(next.indexOf(edge.blocker_id), 1);
    };

    return { path, drop };
}

/** Validate the final graph inside the caller's transaction, including multi-edge writes. */
export function validateBlockers(db: DatabaseSync): void {
    const edges = readEdges(db);
    const { path } = router(edges);

    for (const edge of edges) {
        if (edge.work_id === edge.blocker_id)
            throw new WorkRecordError('invalid', `The work record ${edge.work_id} can't block itself.`);

        const cycle = path(edge.blocker_id, edge.work_id);

        if (cycle)
            throw new WorkRecordError('invalid', `Blockers make a cycle: ${[edge.work_id, ...cycle].join(' → ')}.`);
    }
    for (const edge of edges) {
        const implied = path(edge.work_id, edge.blocker_id, edge);

        if (implied)
            throw new WorkRecordError(
                'invalid',
                `The blocker ${edge.work_id} → ${edge.blocker_id} is already implied by ${implied.join(' → ')}; remove the redundant edge.`,
            );
    }
}

export function reduceBlockers(db: DatabaseSync): void {
    const edges = readEdges(db);
    const { path, drop } = router(edges);
    const remove = db.prepare('DELETE FROM blockers WHERE work_id = ? AND blocker_id = ?');

    for (const edge of edges)
        if (path(edge.work_id, edge.blocker_id, edge)) {
            drop(edge);
            remove.run(edge.work_id, edge.blocker_id);
        }
}
