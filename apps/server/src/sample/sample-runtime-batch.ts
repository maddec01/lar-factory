import type { Item } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

const brief = `## What
Keep the greeting readable.
## Acceptance
The greeting remains readable at both window sizes.
## Affected areas
The greeting view.
## Tests
\`test/greeting.test.ts\`: preserves the greeting at both window sizes.`;

/** Exact S07 wait shapes, confined to the writable sample's disposable records. */
export function sampleRuntimeBatch(records: WorkRecords) {
    let buildId: string | undefined;
    let ids: { groups: string[]; buildId: string } | undefined;

    return {
        project(item: Item): Item {
            return item.id === buildId
                ? {
                      ...item,
                      threads: [
                          {
                              id: 'sample-build-question',
                              title: 'Build question',
                              purpose: 'build',
                              state: 'needs you',
                              updated: item.updatedAt,
                          },
                      ],
                  }
                : item;
        },
        seed(repository: string) {
            if (!repository.startsWith('lar-factory-sample/')) throw Error('Only fake sample work is supported.');

            if (ids) return ids;

            const groups = [];

            for (const kind of ['concept', 'feature'] as const) {
                const parent = records.create({
                    repository,
                    kind,
                    status: 'Shaping',
                    title:
                        kind === 'concept'
                            ? 'Sample concept · parent approval wait'
                            : 'Sample linked work · member approval waits',
                });

                records.setBody(
                    parent.workId,
                    parent.revision,
                    kind === 'concept' ? 'map' : 'brief',
                    '## Destination\nKeep the server and app greeting consistent.',
                );
                groups.push(parent.workId);

                const parts = ['Server greeting', 'App greeting'].map((title) =>
                    records.createPart({
                        parentId: parent.workId,
                        parentRevision: records.read(parent.workId).revision,
                        repository,
                        kind: 'build',
                        title,
                        body: brief,
                        blockerIds: [],
                    }),
                );

                for (const id of kind === 'concept' ? [parent.workId] : parts.map((part) => part.workId))
                    records.waitForUser(id, records.read(id).revision, 'Approve briefs in the board');
                for (const part of parts) {
                    const input = records.doubtPackage(part.workId);

                    records.recordDoubt(part.workId, input.packageDigest, 'Sample Doubt', 'Clean current brief.', []);
                }
            }

            let build = records.create({
                repository,
                kind: 'build',
                title: 'Sample build · product question',
                status: 'In progress',
            });

            build = records.setBody(build.workId, build.revision, 'brief', brief);
            records.recordGate(build.workId, build.revision, {
                briefDigest: records.gate(build.workId).briefDigest!,
                approvedBy: 'Sample Pedro',
                evidence: 'Fake board approval.',
            });
            build = records.setBuildBranch(build.workId, build.revision, 'sample/build-question');
            build = records.setBuildPhase(build.workId, build.revision, 'implement');
            build = records.addThread(build.workId, build.revision, 'sample-build-question', 'build');
            records.waitForUser(build.workId, build.revision, 'Which greeting should be shown? Resume In progress.');
            buildId = build.workId;
            ids = { groups, buildId };

            return ids;
        },
    };
}
