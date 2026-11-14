import { randomUUID } from 'node:crypto';

import type { Database } from './database.ts';
import type { GateApproval } from './gate-display.ts';
import type { WorkRecord } from './work-records.ts';

const approvalWait = (reason: string | null) => /approve.*brief|brief.*approval/i.test(reason ?? '');

/** Resolve a delivery's existing owner, including linked/concept and decision owners. */
export function gateOwner(
    database: Database,
    record: WorkRecord,
    purpose?: 'shape' | 'build',
): { workId: string; threadId: string } | null {
    const { db } = database;
    let owner = db
        .prepare(
            'SELECT work_id,thread_id FROM threads WHERE work_id=? AND deleted_at IS NULL AND (? IS NULL OR purpose=?) ORDER BY rowid DESC LIMIT 1',
        )
        .get(record.workId, purpose ?? null, purpose ?? null);

    if (!owner && record.parentId)
        owner = db
            .prepare(`SELECT t.work_id,t.thread_id FROM threads t JOIN work_records r ON r.work_id=t.work_id
        WHERE (r.work_id=? OR (r.parent_id=? AND r.kind='decision')) AND t.deleted_at IS NULL
        AND (? IS NULL OR t.purpose=?) ORDER BY t.rowid DESC LIMIT 1`)
            .get(record.parentId, record.parentId, purpose ?? null, purpose ?? null);

    return owner ? { workId: String(owner.work_id), threadId: String(owner.thread_id) } : null;
}

/** Called inside the gate transaction; readiness and the owner notification cannot be lost between commits. */
export function queueGateResume(database: Database, record: WorkRecord, value: GateApproval): void {
    const { db } = database;
    const active = !!(record.buildBranch || record.buildPhase || record.pullRequest);

    if (
        record.needsYouCauses.length === 0 &&
        (!record.needsYou || approvalWait(record.needsYou)) &&
        (['List', 'Queued', 'Shaping', 'Needs you'].includes(record.status) ||
            (active && approvalWait(record.needsYou)))
    ) {
        db.prepare(
            'UPDATE work_records SET status=?,needs_you=NULL,queue_order=NULL,revision=revision+1,updated_at=? WHERE work_id=?',
        ).run(active ? 'In progress' : 'Ready', new Date().toISOString(), record.workId);
    }

    const owner = active ? gateOwner(database, record, 'build') : gateOwner(database, record);

    if (!owner) return;

    db.prepare(
        'INSERT OR IGNORE INTO gate_resumes(batch_digest,work_id,thread_id,command_id,message_id,sent,error) VALUES (?,?,?,?,?,0,NULL)',
    ).run(
        value.batchDigest ?? value.approvalDigest ?? value.briefDigest,
        owner.workId,
        owner.threadId,
        randomUUID(),
        randomUUID(),
    );
}

export function gateResumeRecords(database: Database) {
    return {
        pendingGateResumes: () =>
            database.read(() =>
                database.db
                    .prepare('SELECT * FROM gate_resumes WHERE sent=0 ORDER BY rowid')
                    .all()
                    .map((row) => ({
                        digest: String(row.batch_digest),
                        workId: String(row.work_id),
                        threadId: String(row.thread_id),
                        commandId: String(row.command_id),
                        messageId: String(row.message_id),
                        error: row.error as string | null,
                    })),
            ),
        gateResumeResult: (commandId: string, result: 'accepted' | 'unconfirmed' | 'rejected', error?: string) =>
            database.write(() => {
                database.db
                    .prepare('UPDATE gate_resumes SET sent=?,error=?,command_id=? WHERE command_id=?')
                    .run(
                        result === 'accepted' ? 1 : 0,
                        error ?? null,
                        result === 'rejected' ? randomUUID() : commandId,
                        commandId,
                    );
            }),
    };
}
