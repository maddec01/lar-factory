import type { GateEvidence } from '@lar-factory/shared';

import { WorkRecordError, type Database } from './database.ts';
import type { WorkRecords } from './work-records.ts';

export interface BuildPreparation {
    limit: number;
    atWorkIds: string[];
    expectedGateId?: string;
    conceptId?: string;
    automatic?: boolean;
    recovery?: boolean;
}
export interface BuildInput {
    brief: string;
    gate: GateEvidence;
    revision: number;
    blockers: Record<string, number>;
}

/** Called inside the intent's write transaction: eligibility, frozen input and capacity claim commit together. */
export function prepareBuildClaim(
    database: Database,
    records: WorkRecords,
    workId: string,
    input: BuildPreparation,
): BuildInput {
    const work = records.read(workId);
    const gate = records.gate(workId).passing;
    const refuse = (reason: string): never => {
        throw new WorkRecordError('invalid', reason);
    };

    if (!Number.isSafeInteger(input.limit) || input.limit < 1)
        refuse('The shared build capacity must be at least one.');

    if (work.setAside || work.kind === 'concept' || work.kind === 'decision' || work.kind === 'slice')
        refuse('This work cannot start a build.');

    const statuses = input.recovery
        ? ['Ready', 'In progress', 'Review', 'Verify', 'Ready to merge']
        : ['Ready', 'In progress'];

    if (!statuses.includes(work.status))
        refuse(`Only Ready builds or stopped builds can start; status is ${work.status}.`);

    if (!gate) refuse('This build needs a current passing gate before Start build.');

    if (input.expectedGateId && gate?.gateId !== input.expectedGateId)
        refuse('The approved brief changed while preparing. Read it and start again.');

    if (work.needsYou && !input.recovery) refuse(`Needs you: ${work.needsYou}`);

    if (records.specState(workId).held) refuse('Resolve the changed ticket Spec before Start build.');

    if (records.waitingOn(workId).length) refuse('The recorded blockers or Dependencies are not complete.');

    if (work.parentId && records.read(work.parentId).kind === 'concept') {
        const parent = records.read(work.parentId);
        const plan = records.conceptBuildPlan(parent.workId);
        const holds =
            input.automatic && !plan.run
                ? plan.holds
                : plan.holds.filter(
                      (hold) => hold.workId === parent.workId || records.read(hold.workId).kind !== 'build',
                  );

        if (holds.length) refuse(holds.map((hold) => hold.reason).join(' '));

        if (
            input.conceptId &&
            (input.conceptId !== parent.workId || (plan.run?.state !== 'running' && !(input.automatic && !plan.run)))
        )
            refuse('The concept build run is paused.');
    } else if (input.conceptId) refuse('This build no longer belongs to the running concept.');

    const counted = new Set(
        records
            .list({})
            .filter(
                (row) =>
                    !row.setAside &&
                    row.kind !== 'concept' &&
                    row.kind !== 'decision' &&
                    row.kind !== 'slice' &&
                    ['In progress', 'Review'].includes(row.status),
            )
            .map((row) => row.workId),
    );

    for (const id of input.atWorkIds) counted.add(id);
    for (const intent of records.launchIntents({ unresolved: true }))
        if (intent.purpose === 'build') counted.add(intent.workId);
    counted.delete(workId);

    if (counted.size >= input.limit) refuse('The shared build capacity is full. Wait for a build to hand back.');

    return {
        brief: records.body(workId, 'brief')!,
        gate: gate!,
        revision: work.revision,
        blockers: Object.fromEntries(records.blockers(workId).map((blocker) => [blocker.workId, blocker.revision])),
    };
}
