import { isRecord } from '@lar-factory/shared';
import { roleTaskMatches, type RoleRun, type RoleRunFinish } from '@lar-factory/shared/run-settings';
import { roleFinish } from '@lar-factory/work-records/run-settings';

/** Read terminal child facts before an owner-family observation can close an attempt. */
export async function readRoleResult(
    attempt: RoleRun,
    owner: unknown,
    read: (id: string) => Promise<unknown>,
): Promise<{ finish?: RoleRunFinish; absent?: boolean; hold?: string }> {
    if (!isRecord(owner) || !Array.isArray(owner.subagents) || !owner.subagents.every(isRecord))
        return { hold: 'T3 role tasks are unavailable; reconciliation will retry.' };

    const tasks = owner.subagents
        .filter(isRecord)
        .filter((task) => typeof task.id === 'string' && roleTaskMatches(attempt, task.id));

    if (tasks.length === 0) return { absent: true };

    if (tasks.length !== 1)
        return { hold: 'T3 reported conflicting task identities; the owner must reconcile the role evidence.' };

    const task = tasks[0]!;

    if (task.origin !== 'app_owned' || !isRecord(owner.thread) || task.threadId !== owner.thread.id)
        return { hold: 'T3 task owner identity disagrees; the owner must reconcile the role evidence.' };

    if (task.status === 'completed' && (typeof task.result !== 'string' || task.resultOmitted === true))
        return { hold: 'T3 terminal result is not available yet; reconciliation will retry before the owner handoff.' };

    if (!['completed', 'failed', 'cancelled', 'interrupted'].includes(String(task.status)))
        return { hold: 'T3 child is still active; wait for its terminal result.' };

    if (typeof task.childThreadId !== 'string')
        return { hold: 'Terminal child identity is unavailable; the owner must record the T3 task result.' };

    const projection = await read(task.childThreadId);

    if (
        !isRecord(projection) ||
        !isRecord(projection.thread) ||
        projection.thread.id !== task.childThreadId ||
        !Array.isArray(projection.runs) ||
        !Array.isArray(projection.subagents)
    )
        return { hold: 'Terminal child evidence is unavailable; reconciliation will retry.' };

    const runs = projection.runs.filter(isRecord);
    const run = runs.at(-1);

    if (
        !run ||
        runs.some((entry) => ['running', 'queued', 'pending', 'waiting'].includes(String(entry.status))) ||
        projection.subagents.some(
            (entry) => isRecord(entry) && ['running', 'pending', 'waiting'].includes(String(entry.status)),
        )
    )
        return { hold: 'T3 child family has not settled; wait for its terminal result.' };

    if (task.status === 'completed' && run.status !== 'completed')
        return { hold: 'T3 terminal task and run disagree; reconciliation will retry.' };

    if (!isRecord(run.modelSelection) || !Array.isArray(run.modelSelection.options))
        return { hold: 'T3 terminal execution options are unavailable; the owner must record the task result.' };

    // T3 task_status prefers the provider's last actual turn model over the run's requested selection.
    const turns = Array.isArray(projection.providerTurns)
        ? projection.providerTurns
              .filter(isRecord)
              .filter((turn) => run.activeAttemptId && turn.runAttemptId === run.activeAttemptId)
        : [];
    const turn = turns.sort((a, b) => Number(a.ordinal) - Number(b.ordinal)).at(-1);

    return {
        finish: roleFinish(attempt, {
            taskId: task.id,
            status: task.status,
            hasPendingChildRuns: false,
            providerInstanceId: run.providerInstanceId ?? run.modelSelection.instanceId,
            executedModel: turn?.model ?? run.modelSelection.model,
            options: run.modelSelection.options,
            summary: task.result,
        }),
    };
}
