import type { WorkRecords } from '@lar-factory/work-records';
import { DatabaseSync } from 'node:sqlite';

/** Compatibility fixture only: new owners cannot create duplicate board-action notices. */
export function legacyApprovalNotice(records: WorkRecords, id: string, reason: string) {
    const db = new DatabaseSync(records.trackerDatabasePath());

    db.prepare(
        "UPDATE work_records SET needs_you=?,status='Needs you',revision=revision+1,updated_at=? WHERE work_id=?",
    ).run(reason, new Date().toISOString(), id);
    db.close();
}
