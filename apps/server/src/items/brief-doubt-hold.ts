import type { WorkRecord, WorkRecords } from '@lar-factory/work-records';

/** A combined Doubt may belong to a sibling decision. Its exact package digest ties its result to this brief. */
export function briefDoubtHold(records: WorkRecords, record: WorkRecord): string | undefined {
    if (!record.needsYou) return undefined;

    const digest = records.doubtPackage(record.workId).packageDigest;
    const owners = record.parentId ? [records.read(record.parentId), ...records.children(record.parentId)] : [record];
    const reviewed = owners.some((owner) =>
        records
            .runSettings(owner.workId)
            .roleRuns.some(
                (role) => role.role === 'doubt' && role.result === 'completed' && role.summary?.includes(digest),
            ),
    );

    return reviewed ? record.needsYou : undefined;
}
