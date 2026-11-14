import type { Item, ItemThread } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

/** Explicit fake delivery evidence for checking Auto-build views without any real T3 or provider writes. */
export function sampleDelivery(records: WorkRecords) {
    const threads = new Map<string, ItemThread[]>();
    let groupId: string | undefined;

    return {
        project(item: Item): Item {
            const owned = threads.get(item.id);

            return owned
                ? {
                      ...item,
                      threads: owned.map((thread) => ({
                          ...thread,
                          ...(thread.activity?.available
                              ? { activity: { ...thread.activity, readAt: new Date().toISOString() } }
                              : {}),
                      })),
                  }
                : item;
        },
        seed(repository: string) {
            if (!repository.startsWith('lar-factory-sample/')) throw Error('Only fake sample work is supported.');

            if (groupId) return groupId;

            const parent = records.create({
                repository,
                title: 'Sample Auto-build delivery',
                kind: 'concept',
                status: 'Shaping',
            });

            groupId = parent.workId;
            for (const [index, status] of (['In progress', 'Review', 'Ready'] as const).entries()) {
                let work = records.create({
                    repository,
                    title: `Sample delivery part ${index + 1}`,
                    kind: 'build',
                    status,
                });

                work = records.setParent(work.workId, work.revision, parent.workId);
                work = records.setBody(
                    work.workId,
                    work.revision,
                    'brief',
                    '## Approved brief\nKeep the greeting on one line.',
                );
                records.recordGate(work.workId, work.revision, {
                    briefDigest: records.gate(work.workId).briefDigest!,
                    approvedBy: 'Sample Pedro',
                    evidence: 'Fake board approval.',
                });

                if (index === 2) continue;

                work = records.setBuildPhase(work.workId, work.revision, index ? 'review' : 'implement');

                const updated = new Date().toISOString();

                threads.set(work.workId, [
                    {
                        id: `sample-shape-${index}`,
                        title: 'Earlier shaping',
                        purpose: 'shape',
                        state: 'running',
                        updated,
                    },
                    {
                        id: `sample-build-${index}`,
                        title: `Building sample delivery part ${index + 1}`,
                        purpose: 'build',
                        state: 'running',
                        currentRunning: true,
                        updated,
                        activity: {
                            available: true,
                            readAt: updated,
                            action: index ? 'Reviewing the build' : 'Implementing the build',
                            actionAt: updated,
                            agents: [],
                            toolRunning: true,
                        },
                    },
                ]);
            }

            let stale = records.create({
                repository,
                title: 'Sample stale approved brief',
                kind: 'feature',
                status: 'Ready',
            });

            stale = records.setBody(
                stale.workId,
                stale.revision,
                'brief',
                '## Done when\nKeep the greeting on one line.\n### Tests\n`test/greeting.test.js`: preserves the greeting.\n## Scope\n### Files\n`src/greeting.js`',
            );
            records.recordGate(stale.workId, stale.revision, {
                briefDigest: records.gate(stale.workId).briefDigest!,
                approvedBy: 'Sample Pedro',
                evidence: 'Fake board approval.',
            });
            records.setBody(
                stale.workId,
                stale.revision,
                'brief',
                '## Done when\nWrap the greeting on narrow screens.\n### Tests\n`test/greeting.test.js`: wraps on narrow screens.\n## Scope\n### Files\n`src/greeting.js`',
            );

            return groupId;
        },
    };
}
