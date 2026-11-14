import type { WorkRecords } from '@lar-factory/work-records';
import { syncSpecs } from '@lar-factory/work-records/spec-sync';

/** A changed-brief fixture uses the disposable sample's own provider and data folder. */
export async function sampleBriefApproval(
    records: WorkRecords,
    id: string,
    specSync: Parameters<typeof syncSpecs>[1],
    reviewed = true,
) {
    let work = records.read(id);

    if (!work.repository.startsWith('lar-factory-sample/')) throw new Error('Only fake sample work is supported.');

    const scope =
        '\n## Done when\n### Behaviour\n- Greeting stays readable.\n### Tests\n- `test/greeting.test.js`: keeps the greeting visible.\n## Scope\n### Files\n- `src/greeting.js`\n## Cause\nGreeting has fixed width.\n## Evidence\nAt 390 pixels the greeting is clipped.\n## Regression test\n`test/greeting.test.js`: greeting wraps at narrow widths.\n## Red-before-green\nObserve the regression fail against the fixed width, then pass after wrapping.\n';

    work = records.addThread(id, work.revision, 'sample-brief-shaping', 'shape');
    work = records.setBody(id, work.revision, 'brief', '## Approved D1\nKeep the greeting on one line.' + scope);
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
        '## Proposed D2\nWrap the greeting on narrow screens.\n\nKeep the same build, branch and PR.' + scope,
    );

    const input = records.doubtPackage(id);

    if (reviewed) records.recordDoubt(id, input.packageDigest, 'Sample Doubt', 'Fake code reviewed; clean.', []);

    // An independent scope question can coexist with the generated gate wait.
    records.waitForUser(id, work.revision, 'Should narrow layouts wrap the greeting or preserve one line?');
}
