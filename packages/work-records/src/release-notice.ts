import { legacyReleaseNoticeStep, receiptMatchesNotice } from '@lar-factory/shared';

import type { Database } from './database.ts';
import { storedRelease } from './release-records.ts';
import type { WorkRecord } from './work-records.ts';

/** Recover the legacy link and consume only its matching receipt, in the caller's transaction. */
export function resolveReleaseNotice(database: Database, record: WorkRecord): void {
    if (!record.needsYou) return;

    const plan = storedRelease(database, record.workId);
    const step = record.needsYouReleaseStep
        ? plan?.steps.find((step) => step.id === record.needsYouReleaseStep)
        : legacyReleaseNoticeStep(plan, record.needsYou);

    if (!step) return;

    if (step.done && receiptMatchesNotice(step.done.evidence, record.needsYou))
        database.db
            .prepare(
                "UPDATE work_records SET needs_you=NULL,needs_you_release_step=NULL,status=CASE WHEN status='Needs you' THEN 'In progress' ELSE status END,revision=revision+1,updated_at=? WHERE work_id=?",
            )
            .run(new Date().toISOString(), record.workId);
    else if (!record.needsYouReleaseStep)
        database.db
            .prepare('UPDATE work_records SET needs_you_release_step=? WHERE work_id=?')
            .run(step.id, record.workId);
}
