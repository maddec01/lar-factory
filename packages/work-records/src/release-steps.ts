import type { ReleaseStep } from '@lar-factory/shared/group-reconciliation';

import type { WorkRecords } from './work-records.ts';

export interface ReleaseStepRecords {
    releaseSteps(groupId: string): ReleaseStep[];
}

/** The reconcile/map vocabulary is a projection of the one canonical release plan. */
export function releaseStepRecords(records: () => WorkRecords): ReleaseStepRecords {
    return {
        releaseSteps: (id) =>
            (records().releasePlan(id)?.steps ?? []).map((step) => ({
                id: step.id,
                title: step.what,
                who: step.who,
                kind: step.shipsWith?.length ? 'ships-with' : 'step',
                workIds: step.shipsWith ?? [],
                evidence: step.done?.evidence ?? null,
            })),
    };
}
