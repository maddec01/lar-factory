import type { Item, ItemThread } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

/** Explicit fake owner/reviewer activity, confined to the writable sample's disposable records. */
export function sampleReviewControls(records: WorkRecords) {
    let shapeId: string | undefined;
    let reviewId: string | undefined;
    let stopped = false;
    const threadId = 'sample-active-shaping-owner';

    return {
        stop(owner: string) {
            if (owner === threadId) stopped = true;
        },
        project(item: Item): Item {
            if (item.id !== shapeId) return item;

            const thread: ItemThread = {
                id: threadId,
                title: 'Sample active shaping',
                purpose: 'shape',
                state: stopped ? 'stopped' : 'running',
                updated: new Date().toISOString(),
                ...(!stopped && { currentRunning: true }),
            };

            return { ...item, threads: [thread] };
        },
        seed(repository: string) {
            if (!repository.startsWith('lar-factory-sample/')) throw new Error('Only fake sample work is supported.');

            if (shapeId && reviewId) return { shapeId, reviewId };

            let shape = records.create({
                repository,
                kind: 'feature',
                title: 'Sample active shaping controls',
                status: 'Shaping',
            });

            shapeId = shape.workId;
            records.addThread(shapeId, shape.revision, threadId, 'shape');

            let review = records.create({
                repository,
                kind: 'bug',
                title: 'Sample selected reviewers',
                status: 'Review',
            });

            reviewId = review.workId;

            const runId = 'sample-review-settings';

            records.snapshotRun(reviewId, review.revision, {
                runId,
                kind: 'build',
                packaged: {
                    version: 'sample',
                    reviewers: {
                        code: 'Fake code review.',
                        security: 'Fake security review.',
                        ui: 'Fake UI review.',
                        performance: 'Fake performance review.',
                    },
                },
                skills: [],
            });
            records.saveReviewerSelection(reviewId, {
                workId: reviewId,
                runId,
                base: 'a'.repeat(40),
                head: 'b'.repeat(40),
                reviewers: [
                    { id: 'code', name: 'Code', run: true, reason: 'Always: every build receives Code review.' },
                    {
                        id: 'security',
                        name: 'Security',
                        run: true,
                        reason: 'Matched input validation changes in src/greeting.js.',
                    },
                    { id: 'ui', name: 'UI', run: false, reason: 'No visible UI changes in this diff.' },
                ].map((reviewer) => ({
                    ...reviewer,
                    triggerVersion: 1 as const,
                    outcome: reviewer.run ? ('matched' as const) : ('unmatched' as const),
                    rule: 'fixture',
                    evidence: reviewer.reason,
                })),
            });
            for (const role of ['code', 'security'] as const)
                records.startRoleRun(reviewId, records.read(reviewId).revision, {
                    runId,
                    executionId: `sample-${role}`,
                    role: `reviewer:${role}`,
                });
            records.finishRoleRun(reviewId, records.read(reviewId).revision, {
                executionId: 'sample-security',
                report: null,
                result: 'completed',
                summary: 'Approve: boundary inputs are validated; no findings.',
            });

            return { shapeId, reviewId };
        },
    };
}
