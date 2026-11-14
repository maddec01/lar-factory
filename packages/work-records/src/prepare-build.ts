import { reservesBuildSlot, type GateEvidence } from '@lar-factory/shared';

import { groupMembers } from './blocker-declarations.ts';
import { blockerPath, groupContractReferences } from './contract-references.ts';
import { WorkRecordError, type Database } from './database.ts';
import type { WorkRecords } from './work-records.ts';

export interface BuildPreparation {
    limit: number;
    atWorkIds: string[];
    expectedGateId?: string;
    conceptId?: string;
    automatic?: boolean;
    /** Set only by Pedro's item-level board action; never by a scheduler. */
    manual?: boolean;
    recovery?: boolean;
}
export interface BuildInput {
    /** The request at launch. Later tracker edits never rewrite this snapshot. */
    context?: string;
    brief: string;
    gate: GateEvidence;
    revision: number;
    blockers: Record<string, number>;
    /** Claim-time evidence, retained with the launch. Absent on older inputs. */
    capacity?: { source: 'manual' | 'automatic'; limit: number; occupied: number; manualOverride: boolean };
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

    const review = records.doubtPackage(workId);

    if (review.overlaps.some((overlap) => !overlap.ordered && overlap.files.length))
        refuse('File overlap needs an ordering blocker before Start build.');

    let root = work;

    while (root.parentId) root = records.read(root.parentId);

    const contracts = groupContractReferences(records, groupMembers(records, root.workId, true));

    if (
        contracts.unresolved.some((ref) => ref.workId === workId) ||
        (contracts.references.get(workId) ?? []).some((producer) => !blockerPath(records, workId, producer))
    )
        refuse('Resolve contract sources and consumer blockers before Start build.');

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
            .filter((row) => {
                const deliveryStarted =
                    !!row.buildBranch ||
                    !!row.buildPhase ||
                    !!row.pullRequest ||
                    records.threads(row.workId).some((thread) => thread.purpose === 'build');

                return reservesBuildSlot({
                    kind: row.kind,
                    status: row.status,
                    complete: records.completion(row.workId).complete,
                    retired: row.setAside,
                    coordinating:
                        records.children(row.workId).some((child) => child.kind !== 'slice') && !deliveryStarted,
                    deliveryStarted,
                });
            })
            .map((row) => row.workId),
    );

    for (const id of input.atWorkIds) counted.add(id);
    for (const intent of records.launchIntents({ unresolved: true }))
        if (intent.purpose === 'build') counted.add(intent.workId);
    counted.delete(workId);

    const ownsSlot =
        records.threads(workId).some((thread) => thread.purpose === 'build') ||
        records.launchIntents({ workId }).some((intent) => intent.purpose === 'build' && intent.outcome !== 'failed');
    const full = !ownsSlot && counted.size >= input.limit;

    const manual = input.manual === true;

    if (full && !manual) refuse('Waiting for a build slot. The shared build capacity is full.');

    return {
        capacity: {
            source: manual ? 'manual' : 'automatic',
            limit: input.limit,
            occupied: counted.size,
            manualOverride: full && manual,
        },
        context: records.initialContext(workId),
        brief: records.body(workId, 'brief')!,
        gate: gate!,
        revision: work.revision,
        blockers: Object.fromEntries(records.blockers(workId).map((blocker) => [blocker.workId, blocker.revision])),
    };
}
