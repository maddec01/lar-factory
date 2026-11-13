import { isRecord } from '@lar-factory/shared';
import { executionMismatch, executionSettingsOf } from '@lar-factory/shared/execution-target';
import type { ExecutionSettings, RoleRunFinish } from '@lar-factory/shared/run-settings';
import { randomUUID } from 'node:crypto';

import { readExecutionProjection } from './execution-capabilities.ts';
import { parseSelection } from './model-choices.ts';
import { sendThreadCommand } from './thread-commands.ts';

/** A run's reported selection takes precedence over the thread's next-turn selection. */
export function executionReport(projection: unknown, threadId: string): RoleRunFinish['report'] {
    if (!isRecord(projection) || !isRecord(projection.thread) || projection.thread.id !== threadId) return null;

    const runs = Array.isArray(projection.runs) ? projection.runs.filter(isRecord) : [];
    const run = runs.at(-1);
    const raw = run ? run.modelSelection : projection.thread.modelSelection;
    const selection = parseSelection(raw);

    if (
        !selection ||
        !selection.instanceId.trim() ||
        !selection.model.trim() ||
        !isRecord(raw) ||
        (raw.options !== undefined &&
            (!Array.isArray(raw.options) || raw.options.length !== (selection.options?.length ?? 0)))
    )
        return null;

    const options = selection.options ?? [];

    if (
        new Set(options.map((option) => option.id)).size !== options.length ||
        options.some((option) => !option.id.trim()) ||
        options.filter((option) => ['effort', 'reasoningEffort'].includes(option.id)).length > 1
    )
        return null;

    return {
        source: 't3',
        reference: typeof run?.id === 'string' ? run.id : threadId,
        actual: executionSettingsOf(selection),
    };
}

/** Hold a mismatched active run before accepting its work. The prompt also verifies before starting roles. */
export async function verifyExecution(projection: unknown, threadId: string, requested: ExecutionSettings) {
    const report = executionReport(projection, threadId);
    let failure = report
        ? executionMismatch(requested, report.actual)
        : 'T3 did not report the launched model and options. Hold until the thread selection can be verified.';

    if (failure && isRecord(projection) && Array.isArray(projection.runs)) {
        for (const run of projection.runs.filter(isRecord)) {
            if (run.status !== 'running' || typeof run.id !== 'string') continue;

            const stopped = await sendThreadCommand({
                type: 'run.interrupt',
                commandId: randomUUID(),
                threadId,
                runId: run.id,
            });

            if (stopped.outcome !== 'accepted') failure += ` Interrupt not confirmed: ${stopped.reason}`;
        }
    }

    return { report, failure };
}

export async function verifyRecoveredExecution(threadId: string, requested: ExecutionSettings) {
    try {
        return await verifyExecution(await readExecutionProjection(threadId), threadId, requested);
    } catch {
        return {
            report: null,
            failure: 'Cannot verify recovered T3 execution. Hold until T3 reports its model and options.',
        };
    }
}
