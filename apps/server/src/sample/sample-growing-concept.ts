import type { Item } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

/** A disposable stress fixture for concept views; all records and thread links belong to the fake sample. */
export function sampleGrowingConcept(records: WorkRecords) {
    let groupId: string | undefined;

    return {
        project(item: Item): Item {
            if (item.id !== groupId) return item;

            return {
                ...item,
                threads: [
                    {
                        id: 'sample-concept-owner',
                        purpose: 'shape',
                        title: 'Review the growing concept',
                        state: 'done',
                        updated: item.updatedAt,
                    },
                ],
            };
        },
        seed(repositories: string[]) {
            if (repositories.length < 2 || repositories.some((repo) => !repo.startsWith('lar-factory-sample/')))
                throw Error('Choose at least two fake sample repositories.');

            if (groupId) return groupId;

            const group = records.create({
                title: 'Growing greeting concept',
                repository: repositories[0]!,
                kind: 'concept',
                status: 'Shaping',
            });

            groupId = group.workId;
            records.setBody(
                group.workId,
                group.revision,
                'map',
                '## Destination\nSend <fragment> to the greeting view.\n\n## Fog\nNone.',
            );

            const builds = [];

            for (let index = 1; index <= 22; index++) {
                let build = records.createPart({
                    parentId: group.workId,
                    parentRevision: records.read(group.workId).revision,
                    title:
                        index === 1
                            ? 'b01: Produce the compatible greeting contract with the accepted immutable manifest'
                            : `b${String(index).padStart(2, '0')}: greeting fixture ${index}`,
                    kind: 'build',
                    repository: repositories[(index === 4 ? 4 : index - 1) % repositories.length]!,
                    body: '## Goal\nPreserve <fragment> as literal text.\n\n## Acceptance\nThe greeting remains compatible.',
                    blockerIds: [],
                });

                if (index === 1) build = records.update(build.workId, build.revision, { status: 'Ready' });

                builds.push(build);
            }
            records.addBlocker(builds[1]!.workId, records.read(builds[1]!.workId).revision, builds[0]!.workId);
            records.mergeBuild(builds[3]!.workId, records.read(builds[3]!.workId).revision, {
                into: builds[4]!.workId,
                revisions: {
                    [builds[4]!.workId]: records.read(builds[4]!.workId).revision,
                    [group.workId]: records.read(group.workId).revision,
                },
            });
            records.setAside(builds[5]!.workId, records.read(builds[5]!.workId).revision);

            const decision = records.createPart({
                parentId: group.workId,
                parentRevision: records.read(group.workId).revision,
                title: 'D4: Clarification of bounded fourteen-case fixture coverage',
                repository: repositories[1]!,
                kind: 'decision',
                body: 'Method: grill\nClarify the bounded fixture coverage.',
                blockerIds: [],
            });

            records.update(decision.workId, decision.revision, { decisionMethod: 'grill' });

            records.setReleasePlan(group.workId, records.read(group.workId).revision, {
                steps: [
                    {
                        id: 'approve-manifest',
                        who: 'Pedro',
                        what: 'Approve the exact greeting manifest before activation',
                    },
                ],
                outcomeCheck: 'Check the delivered greeting',
            });

            return groupId;
        },
    };
}
