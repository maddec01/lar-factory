// Delivery cleanup retries after the owner ends its terminal turn, using the existing ownership checks.
import { currentBuildThread, isLiveThread, type Item } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

import { log } from '../log.ts';
import { readObservedPr } from './pr-progress.ts';
import { inspectCleanup, executeCleanup } from './work-cleanup.ts';

export function createMergedCleanup(
    records: WorkRecords | null,
    dependencies: {
        context(
            item: Item,
        ): Promise<{ checkout: string; defaultBranch: string; liveWorktreePaths: string[]; writable: boolean }>;
        read?: typeof readObservedPr;
        inspect?: typeof inspectCleanup;
        execute?: typeof executeCleanup;
    },
) {
    const attempted = new Map<string, number>();
    const completed = new Set<string>();
    let running = false;

    return async (items: readonly Item[], now = Date.now()) => {
        if (!records || running) return;

        running = true;

        try {
            for (const item of items) {
                if (item.recorded === false || item.status !== 'Done' || item.setAside || item.paused) continue;

                const record = records.read(item.id);
                const reference = record.pullRequest;
                const owner = currentBuildThread(item);
                const key = `${item.id}:${reference}`;

                if (
                    !record.finishedAt ||
                    !record.buildBranch ||
                    !reference ||
                    !reference.startsWith(`${record.repository}#`) ||
                    !records.verification(item.id).prReview ||
                    !owner ||
                    owner.currentRunning ||
                    isLiveThread(owner) ||
                    (owner.hasRunningChildren && !owner.watchingPrs?.length) ||
                    completed.has(key) ||
                    now - (attempted.get(key) ?? -Infinity) < 60_000
                )
                    continue;

                attempted.set(key, now);

                try {
                    const number = Number(reference.slice(reference.lastIndexOf('#') + 1));
                    const pr = await (dependencies.read ?? readObservedPr)(record.repository, number);
                    const head = pr.sourceRevision;

                    if (pr.state !== 'merged' || !head || !/^[a-f0-9]{40,64}$/.test(head)) continue;

                    const context = await dependencies.context(item);
                    const inspect = () =>
                        (dependencies.inspect ?? inspectCleanup)({
                            ...context,
                            item,
                            repository: record.repository,
                            branch: record.buildBranch,
                            sliceIds: [],
                            sliceBranches: [],
                            mergedHead: head,
                        });
                    const plan = await inspect();

                    // A moved source branch, stale provider read or unpushed/dirty work is retained.
                    if (
                        plan.warning ||
                        plan.dirtyFiles.length ||
                        plan.unpushedCommits.length ||
                        (plan.remoteBranch && (plan.remoteHead !== head || !plan.remoteAvailable))
                    )
                        continue;

                    const fresh = await inspect();

                    if (records.read(item.id).pullRequest !== reference) continue;

                    const result = await (dependencies.execute ?? executeCleanup)({
                        plan: fresh,
                        expectedPlan: plan,
                        checkout: context.checkout,
                        repository: record.repository,
                        local: true,
                        remote: !!plan.remoteBranch,
                        confirmedLoss: false,
                    });

                    if (!result.errors.length && !result.remainingBranches.length) completed.add(key);
                    else log(`Merged delivery cleanup kept ${record.buildBranch}: ${result.errors.join(' ')}`);
                } catch (error) {
                    log(`Merged delivery cleanup retained ${record.buildBranch}: ${(error as Error).message}`);
                }
            }
        } finally {
            running = false;
        }
    };
}
