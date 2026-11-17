import type { Item, ItemThread } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

/** Explicit fake owner/reviewer activity, confined to the writable sample's disposable records. */
export function sampleReviewControls(records: WorkRecords) {
    let shapeId: string | undefined;
    let reviewId: string | undefined;
    let partId: string | undefined;
    let stopped = false;
    const threadId = 'sample-active-shaping-owner';

    /** A review round on `workId`: `reviewers` chosen, the ones that run started, the last of them finished. */
    const reviewRound = (
        workId: string,
        runId: string,
        reviewers: { id: string; name: string; run: boolean; reason: string }[],
    ) => {
        records.snapshotRun(workId, records.read(workId).revision, {
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
        records.saveReviewerSelection(workId, {
            workId,
            runId,
            base: 'a'.repeat(40),
            head: 'b'.repeat(40),
            reviewers: reviewers.map((reviewer) => ({
                ...reviewer,
                triggerVersion: 1 as const,
                outcome: reviewer.run ? ('matched' as const) : ('unmatched' as const),
                rule: 'fixture',
                evidence: reviewer.reason,
            })),
        });

        const running = reviewers.filter((reviewer) => reviewer.run);

        for (const { id } of running)
            records.startRoleRun(workId, records.read(workId).revision, {
                runId,
                executionId: `${runId}-${id}`,
                role: `reviewer:${id}`,
            });
        records.finishRoleRun(workId, records.read(workId).revision, {
            executionId: `${runId}-${running.at(-1)!.id}`,
            report: null,
            result: 'completed',
            summary: 'Approve: boundary inputs are validated; no findings.',
        });
    };

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
        /** A shaping item with a stoppable owner and a single build mid-review; given a `partner` repository too, a
         *  linked-work part mid-review under a parent spanning both, as a live linked run has its producer. */
        seed(repository: string, partner?: string) {
            if (![repository, partner ?? repository].every((repo) => repo.startsWith('lar-factory-sample/')))
                throw new Error('Only fake sample work is supported.');

            if (shapeId && reviewId) return { shapeId, reviewId, ...(partId && { partId }) };

            const shape = records.create({
                repository,
                kind: 'feature',
                title: 'Sample active shaping controls',
                status: 'Shaping',
            });

            shapeId = shape.workId;
            records.addThread(shapeId, shape.revision, threadId, 'shape');

            const review = records.create({
                repository,
                kind: 'bug',
                title: 'Sample selected reviewers',
                status: 'Review',
            });

            reviewId = review.workId;
            reviewRound(reviewId, 'sample-review-settings', [
                { id: 'code', name: 'Code', run: true, reason: 'Always: every build receives Code review.' },
                {
                    id: 'security',
                    name: 'Security',
                    run: true,
                    reason: 'Matched input validation changes in src/greeting.js.',
                },
                { id: 'ui', name: 'UI', run: false, reason: 'No visible UI changes in this diff.' },
            ]);

            if (partner && partner !== repository) {
                const parent = records.create({
                    repository,
                    kind: 'feature',
                    title: 'Sample linked work in review',
                    status: 'Shaping',
                });
                const part = records.createPart({
                    parentId: parent.workId,
                    parentRevision: parent.revision,
                    title: 'Publish the greeting contract',
                    kind: 'build',
                    repository,
                    body: '## Goal\nPublish the greeting contract.',
                    blockerIds: [],
                });

                records.createPart({
                    parentId: parent.workId,
                    parentRevision: records.read(parent.workId).revision,
                    title: 'Show the greeting from the contract',
                    kind: 'build',
                    repository: partner,
                    body: '## Goal\nShow the greeting from the contract.',
                    blockerIds: [part.workId],
                });
                partId = part.workId;
                records.update(partId, records.read(partId).revision, { status: 'Review' });
                reviewRound(partId, 'sample-linked-review', [
                    { id: 'code', name: 'Code', run: true, reason: 'Always: every build receives Code review.' },
                    { id: 'performance', name: 'Performance', run: true, reason: 'Matched the contract fixtures.' },
                ]);
            }

            return { shapeId, reviewId, ...(partId && { partId }) };
        },
    };
}
