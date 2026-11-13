import type { WorkRecords } from '@lar-factory/work-records';
import { syncSpecs } from '@lar-factory/work-records/spec-sync';

/** A changed-brief fixture uses the disposable sample's own provider and data folder. */
export async function sampleBriefApproval(records: WorkRecords, id: string, specSync: Parameters<typeof syncSpecs>[1]) {
    let work = records.read(id);

    if (!work.repository.startsWith('lar-factory-sample/')) throw new Error('Only fake sample work is supported.');

    work = records.setBody(id, work.revision, 'brief', '## Approved D1\nKeep the greeting on one line.');
    records.recordGate(id, work.revision, {
        briefDigest: records.gate(id).briefDigest!,
        approvedBy: 'Sample Pedro',
        evidence: 'Fake previous board approval.',
    });
    await syncSpecs(records, { ...specSync, workId: id });
    work = records.read(id);
    work = records.setBuildBranch(id, work.revision, 'sample/same-build');
    work = records.setBuildPhase(id, work.revision, 'implement');
    work = records.setBody(
        id,
        work.revision,
        'brief',
        '## Proposed D2\nWrap the greeting on narrow screens.\n\nKeep the same build, branch and PR.',
    );

    const input = records.doubtPackage(id);

    records.recordDoubt(id, input.packageDigest, 'Sample Doubt', 'Fake code reviewed; clean.', []);
    records.waitForUser(id, work.revision, 'Approve revised brief after failed Verify.');
}
