import { isLiveThread, isRecord, ownerThreads, type Item } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

import { readExecutionProjection } from '../t3/execution-capabilities.ts';
import { readRoleResult } from '../t3/role-result.ts';

/** Current T3 facts clear an old question notice; unavailable/cached activity never proves resolution. */
export async function reconcileOwnerActivity(
    records: WorkRecords,
    item: Item,
    read: (id: string) => Promise<unknown> = readExecutionProjection,
): Promise<void> {
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

    // Capture candidates before the async read, so a later launch cannot be abandoned by an older observation.
    const { roleRuns, runs } = records.runSettings(item.id);
    const candidates = roleRuns.filter(
        (run) =>
            run.role !== 'thread' &&
            (run.result === 'running' || run.inferredAbandonment || run.failure?.startsWith('Abandoned execution:')),
    );

    if (!candidates.length) return;

    const threadHistory = records.threads(item.id);
    const launches = records.launchIntents({ workId: item.id });
    const projections = new Map<string, unknown>();
    const holds: Record<string, string> = {};
    const absent: string[] = [];

    for (const attempt of candidates) {
        const kind = runs.find((run) => run.runId === attempt.runId)?.kind;
        const launched = roleRuns
            .filter((run) => run.role === 'thread' && run.runId === attempt.runId && run.startedAt <= attempt.startedAt)
            .at(-1);
        const ownerId =
            launched?.threadId ??
            launches.find((intent) => intent.intentId === launched?.executionId)?.threadId ??
            threadHistory
                .filter(
                    (thread) =>
                        !thread.deletedAt &&
                        thread.recordedAt <= attempt.startedAt &&
                        (thread.purpose === 'build') === (kind === 'build'),
                )
                .at(-1)?.threadId;
        const owner = item.threads.find((thread) => thread.id === ownerId);

        if (!owner || owner.observedAt) continue;

        try {
            if (!projections.has(owner.id)) projections.set(owner.id, await read(owner.id));

            const projection = projections.get(owner.id);

            if (!isRecord(projection) || !isRecord(projection.thread) || projection.thread.id !== owner.id)
                throw new Error('Unavailable owner projection');

            const result = await readRoleResult(attempt, projection, read);

            if (result.finish) records.finishRoleRun(item.id, records.read(item.id).revision, result.finish);
            else if (
                result.absent &&
                ownerEnded &&
                Array.isArray(projection.runs) &&
                !projection.runs.some((run) => isRecord(run) && ['running', 'queued'].includes(String(run.status)))
            )
                absent.push(attempt.executionId);
            else holds[attempt.executionId] = result.hold ?? 'Owner continuation is active; wait for role evidence.';
        } catch {
            // A continuation can finish the same attempt while a read is in flight. Genuine terminal records stay immutable.
            holds[attempt.executionId] =
                'T3 role evidence is unavailable or changed; the system will retry, or the owner can run role-finish.';
        }
    }
    records.reconcileRoleRuns(item.id, { ownerEnded, executionIds: absent, holds });
}
