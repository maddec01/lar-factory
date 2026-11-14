import type { WorkRecords } from '@lar-factory/work-records';

/** Disposable failed-composition evidence; no provider or T3 calls. */
export function sampleOutcome(records: WorkRecords) {
    let id: string | undefined;

    return (repository: string) => {
        if (id) return id;

        if (!repository.startsWith('lar-factory-sample/')) throw Error('Only fake sample work is supported.');

        id = records.create({
            repository,
            title: 'Linked greeting composition',
            kind: 'feature',
            status: 'In progress',
        }).workId;

        const at = () => records.read(id!).revision;

        records.addThread(id, at(), 'sample-outcome-owner', 'shape');

        const part = records.createPart({
            parentId: id,
            parentRevision: at(),
            title: 'Display accepted greeting',
            repository,
            kind: 'build',
            body: 'Blocked by: none',
            blockerIds: [],
        });

        records.setPullRequest(part.workId, part.revision, `${repository}#991`);
        records.observe(part.workId, records.read(part.workId).revision, { of: 'pr', state: 'merged' });
        records.setReleasePlan(id, at(), { steps: [], outcomeCheck: 'A factory → B consumer → C display composition' });
        records.recordOutcomeCheck(
            id,
            at(),
            'failed',
            'Sample Outcome owner',
            'C exports displayGreeting(element) with a module constant; there is no B→C accepted-text input.',
        );

        return id;
    };
}
