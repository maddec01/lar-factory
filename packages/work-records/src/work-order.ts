import { comparePartOrder } from '@lar-factory/shared';
import type { GateResult } from '@lar-factory/shared';

import { WorkRecordError } from './database.ts';
import type { WorkRecord, WorkRecords } from './work-records.ts';

export interface OrderedWork {
    workId: string;
    createdAt: string;
    partOrder?: number;
    number?: number;
    title: string;
    repository: string;
    kind: WorkRecord['kind'];
    status: WorkRecord['status'];
    revision: number;
    brief: string;
    gate: GateResult;
    blockers: { workId: string; title: string; complete: boolean }[];
    waits: string[];
    complete: boolean;
    setAside: boolean;
}

/** Stable display order: prerequisites first, then creation order; approval renewal never moves a part. */
export function orderWork(rows: readonly OrderedWork[]): OrderedWork[] {
    const pending = new Map(rows.map((row) => [row.workId, row]));
    const result: OrderedWork[] = [];
    const compare = (a: OrderedWork, b: OrderedWork) =>
        comparePartOrder({ ...a, id: a.workId }, { ...b, id: b.workId });

    while (pending.size) {
        const next = [...pending.values()]
            .filter((row) => row.blockers.every((blocker) => !pending.has(blocker.workId)))
            .sort(compare)[0];

        if (!next) throw new WorkRecordError('invalid', 'The group blocker graph contains a cycle.');

        result.push(next);
        pending.delete(next.workId);
    }

    return result;
}

/** Read within records.snapshot when the caller awaits, so every detail comes from the same database state. */
export function workOrder(records: WorkRecords, groupId: string): OrderedWork[] {
    const deliveryGroup =
        records.read(groupId).kind === 'concept' || records.children(groupId).some((child) => child.kind !== 'slice');

    const descendants = (id: string): WorkRecord[] =>
        records
            .children(id)
            .flatMap((child) => (deliveryGroup && child.kind === 'slice' ? [] : [child, ...descendants(child.workId)]));

    return orderWork(
        descendants(groupId).map((record, index) => {
            const id = record.workId;
            const complete = records.completion(id).complete;
            const gate = records.gate(id);
            const waits = records
                .waitingOn(id)
                .flatMap((wait) =>
                    'workId' in wait
                        ? [`Waits for ${records.read(wait.workId).title}: ${wait.reasons.join(' ')}`]
                        : [`Dependency ${wait.dependencyId}: ${wait.reasons.join(' ')}`],
                );

            if (record.setAside) waits.push('Set aside.');
            else if (!complete) {
                if (record.needsYou) waits.push(record.needsYou);

                if (record.kind === 'decision') waits.push(...records.completion(id).reasons);
                else {
                    if (!gate.passing) waits.push('The current brief needs an approved gate.');

                    if (records.specState(id).held) waits.push('The ticket Spec has an unresolved change.');

                    if (record.status !== 'Ready') waits.push(`Status is ${record.status}.`);

                    if (record.status === 'Done') waits.push(...records.completion(id).reasons);
                }
            }

            return {
                workId: id,
                createdAt: record.createdAt,
                partOrder: index + 1,
                number: record.ticket ? Number(record.ticket.split('#').at(-1)) : 0,
                title: record.title,
                repository: record.repository,
                kind: record.kind,
                status: record.status,
                revision: record.revision,
                brief: records.body(id, 'brief') ?? '',
                gate,
                blockers: records
                    .blockers(id)
                    .filter((blocker) => !deliveryGroup || blocker.kind !== 'slice')
                    .map((blocker) => ({
                        workId: blocker.workId,
                        title: blocker.title,
                        complete: records.completion(blocker.workId).complete,
                    })),
                waits: complete ? [] : waits,
                complete,
                setAside: record.setAside,
            };
        }),
    );
}

export function workOrderReport(rows: readonly OrderedWork[]): string {
    return (
        rows
            .map((row, index) =>
                [
                    `${index + 1}. ${row.title} (${row.workId}) — ${row.repository} — ${row.status}`,
                    `   Brief: ${row.brief ? 'saved' : 'missing'}; gate: ${row.gate.passing?.recordedAt ?? 'not approved'}`,
                    `   Blockers: ${row.blockers.map((blocker) => `${blocker.title} (${blocker.complete ? 'complete' : 'waiting'})`).join(', ') || 'none'}`,
                    `   ${row.complete ? 'Complete.' : row.waits.join(' ') || 'Ready to build.'}`,
                ].join('\n'),
            )
            .join('\n\n') + '\n'
    );
}
