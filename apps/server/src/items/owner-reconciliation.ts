import { isLiveThread, ownerThreads, type Item } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

/** Current T3 facts clear an old question notice; unavailable/cached activity never proves resolution. */
export function reconcileOwnerActivity(records: WorkRecords, item: Item): void {
    if (!Array.isArray(item.threads)) return;

    const owners = ownerThreads(item);
    const current = owners[0];

    if (!current || current.observedAt) return;

    if (current.pendingRequest?.kind !== 'brief-approval')
        records.reconcileUserWait(item.id, {
            threadId: current.id,
            ...(current.pendingRequest && { requestId: current.pendingRequest.id }),
            running: !!current.currentRunning && !current.pendingRequest && !current.childNeedsYou,
        });

    // An owner ending its turn is proof only when the entire observed family has settled.
    const ownerEnded = item.threads.every(
        (thread) => !thread.observedAt && !isLiveThread(thread) && !thread.hasRunningChildren,
    );

    records.reconcileRoleRuns(item.id, { ownerEnded });
}
