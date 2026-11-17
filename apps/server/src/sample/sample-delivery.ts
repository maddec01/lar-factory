import type { Item, ItemThread, LinkedPr } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

/** Explicit fake delivery evidence for checking Auto-build views without any real T3 or provider writes. */
export function sampleDelivery(records: WorkRecords) {
    const threads = new Map<string, ItemThread[]>();
    const reviews = new Map<string, NonNullable<LinkedPr['review']>>();
    let groupId: string | undefined;
    let manualId: string | undefined;

    return {
        reviewLoop(repository: string) {
            if (!repository.startsWith('lar-factory-sample/')) throw Error('Only fake sample work is supported.');

            if (reviews.size) return [...reviews.keys()];

            for (const [index, review] of (
                [
                    { required: 'green' },
                    {
                        required: 'green',
                        comments: [
                            {
                                id: 'sample-comment',
                                author: 'Sample teammate',
                                body: 'Please remember the selected language between visits.',
                                url: 'https://github.com/lar-factory-sample/demo/pull/992#issuecomment-1',
                            },
                            {
                                id: 'sample-comment-2',
                                author: 'Sample teammate',
                                body: 'Support Enter to greet too.',
                                url: 'https://github.com/lar-factory-sample/demo/pull/992#issuecomment-2',
                            },
                        ],
                    },
                    { required: 'pending' },
                    {
                        required: 'green',
                        comments: [
                            {
                                id: 'sample-direct-comment',
                                author: 'Sample teammate',
                                body: 'Use two letters for the badge.',
                                url: 'https://github.com/lar-factory-sample/demo/pull/994#discussion_r1',
                            },
                        ],
                    },
                    { required: 'green', unresolvedThreads: 1 },
                ] satisfies NonNullable<LinkedPr['review']>[]
            ).entries()) {
                let work = records.create({
                    repository,
                    title: [
                        'Sample PR awaiting human review',
                        'Sample PR with new feedback',
                        'Sample PR waiting for checks',
                        'Sample PR fixing review feedback',
                        'Sample PR awaiting conversation resolution',
                    ][index]!,
                    kind: 'build',
                    status: 'Review',
                });

                work = records.setPullRequest(work.workId, work.revision, `${repository}#${991 + index}`);
                work = records.addThread(work.workId, work.revision, `sample-pr-owner-${index}`, 'build');

                if (index === 3) {
                    const parent = records.create({
                        repository,
                        title: 'Sample linked feedback correction',
                        kind: 'concept',
                        status: 'Review',
                    });

                    work = records.setParent(work.workId, work.revision, parent.workId);
                }

                if (index === 1)
                    records.proposeRetro(work.workId, work.revision, [
                        {
                            title: 'Support more greeting languages',
                            description: 'Add more languages in a later build.',
                            repository,
                            kind: 'feature',
                        },
                    ]);

                threads.set(work.workId, [
                    {
                        id: `sample-pr-owner-${index}`,
                        title: index === 3 ? 'Sample active PR owner' : 'Sample idle PR owner',
                        purpose: 'build',
                        state: index === 3 ? 'running' : 'done',
                        ...(index === 3
                            ? {
                                  currentRunning: true,
                                  activity: {
                                      available: true as const,
                                      readAt: new Date().toISOString(),
                                      action: 'Running a command',
                                      actionAt: new Date().toISOString(),
                                      toolRunning: true,
                                      agents: [],
                                  },
                              }
                            : {}),
                        watchingPrs: [],
                        updated: new Date().toISOString(),
                    },
                ]);
                reviews.set(work.workId, review);
            }

            return [...reviews.keys()];
        },
        manualOverride(repository: string, capacity: { limit: number }) {
            if (!repository.startsWith('lar-factory-sample/')) throw Error('Only fake sample work is supported.');

            if (manualId) return manualId;

            let work = records.create({
                repository,
                title: 'Sample manual build over the limit',
                kind: 'build',
                status: 'Ready',
            });

            work = records.setBody(
                work.workId,
                work.revision,
                'brief',
                '## Approved brief\nDeliver an independent fake greeting helper.',
            );
            records.recordGate(work.workId, work.revision, {
                briefDigest: records.gate(work.workId).briefDigest!,
                approvedBy: 'Sample Pedro',
                evidence: 'Fake board approval.',
            });

            const { intent } = records.prepareBuild(work.workId, records.read(work.workId).revision, {
                ...capacity,
                manual: true,
            });

            records.resolveLaunchIntent(work.workId, records.read(work.workId).revision, intent.intentId, {
                threadId: 'sample-manual-build',
            });
            records.setBuildPhase(work.workId, records.read(work.workId).revision, 'implement');
            manualId = work.workId;
            threads.set(manualId, [
                {
                    id: 'sample-manual-build',
                    title: 'Sample manual override',
                    purpose: 'build',
                    state: 'running',
                    currentRunning: true,
                    updated: new Date().toISOString(),
                },
            ]);

            return manualId;
        },
        project(item: Item): Item {
            const owned = threads.get(item.id);
            const review = reviews.get(item.id);

            if (review)
                item = {
                    ...item,
                    verification: { ...item.verification!, required: false, prReview: true },
                    linkedPrs: item.linkedPrs.map((pr) => ({
                        ...pr,
                        pipelineUnread: undefined,
                        review,
                        mergeState: review.unresolvedThreads ? 'blocked' : 'can merge',
                        checkProgress: { state: 'current' },
                    })),
                };

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

            const review = records.doubtPackage(stale.workId);

            records.recordDoubt(stale.workId, review.packageDigest, 'Sample Doubt', 'Revised brief reviewed.');

            return groupId;
        },
    };
}
