import type { SavedRunChoices } from '@lar-factory/shared';
import type { FactoryRole } from '@lar-factory/shared/factory-settings';
import type { WorkRecords } from '@lar-factory/work-records';

/** Item details show recorded choices, never a resolution against today's Settings. */
export function savedRunChoices(records: WorkRecords, workId: string): SavedRunChoices[] {
    return records.runSettings(workId).runs.map((run) => ({
        runId: run.runId,
        kind: run.kind,
        capturedAt: run.capturedAt,
        thread: { model: run.thread.model, effort: run.thread.effort },
        roles: Object.entries(run.roles).map(([role, choice]) => ({
            role: role as FactoryRole,
            model: choice.model,
            effort: choice.effort,
        })),
        reviewers: run.reviewers.map(({ id, name, mode, instructions }) => ({
            id,
            name,
            mode: mode.kind,
            instructions:
                instructions.source.kind === 'packaged'
                    ? `Packaged ${instructions.source.version}`
                    : `Custom revision ${instructions.source.revision}`,
        })),
    }));
}
