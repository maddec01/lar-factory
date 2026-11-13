import type { FactoryRole } from '@lar-factory/shared/factory-settings';

import type { Database } from './database.ts';
import type { BuildPhase, WorkRecord } from './work-records.ts';

const starts: Partial<Record<FactoryRole, BuildPhase>> = {
    planner: 'plan',
    implementer: 'implement',
    'domain-docs': 'domain-docs',
    checks: 'full-checks',
    approver: 'approve',
    'ci-fixer': 'checks',
};
const finishes: Partial<Record<FactoryRole, BuildPhase>> = { planner: 'implement', approver: 'checks' };

/** Joins the role evidence transaction; its caller owns the single revision bump. */
export function recordRolePhase(database: Database, record: WorkRecord, role: string, finished = false): void {
    if (['concept', 'decision', 'slice'].includes(record.kind) || record.finishedAt || record.setAside) return;

    const started = role.startsWith('reviewer:') ? 'review' : starts[role as FactoryRole];
    const phase = finished ? finishes[role as FactoryRole] : started;

    // A late result cannot move a build back from a step already started elsewhere.
    if (!phase || (finished && record.buildPhase !== started)) return;

    database.db
        .prepare(
            `UPDATE work_records SET build_phase=?,
             status=CASE WHEN ?='review' THEN 'Review' ELSE status END,
             queue_order=CASE WHEN ?='review' THEN NULL ELSE queue_order END WHERE work_id=?`,
        )
        .run(phase, phase, phase, record.workId);
}
