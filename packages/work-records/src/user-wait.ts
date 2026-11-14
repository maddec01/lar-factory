import type { Database } from './database.ts';
import type { WorkRecords } from './work-records.ts';

export interface UserWaitRecords {
    reconcileUserWait(workId: string, observation: { threadId: string; requestId?: string; running: boolean }): void;
}

/** Retain the exact observed request across restarts; ordinary activity alone cannot answer a question. */
export function userWaitRecords(database: Database, get: () => WorkRecords): UserWaitRecords {
    const { db } = database;

    return {
        reconcileUserWait: (workId, { threadId, requestId, running }) =>
            database.write(() => {
                const records = get();
                const record = records.read(workId);

                if (record.setAside || record.finishedAt) return;

                if (requestId) {
                    db.prepare(
                        'INSERT INTO owner_waits VALUES (?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET thread_id=excluded.thread_id,request_id=excluded.request_id,notice=excluded.notice WHERE owner_waits.thread_id<>excluded.thread_id OR owner_waits.request_id<>excluded.request_id OR owner_waits.notice IS NOT excluded.notice',
                    ).run(workId, threadId, requestId, record.needsYou);

                    return;
                }

                const wait = db
                    .prepare('SELECT * FROM owner_waits WHERE work_id=? AND thread_id=?')
                    .get(workId, threadId);

                if (!running || !wait) return;

                db.prepare('DELETE FROM owner_waits WHERE work_id=?').run(workId);

                if (
                    record.needsYou !== wait.notice ||
                    record.needsYouCauses.length ||
                    /approve.*brief|brief.*approval/i.test(record.needsYou ?? '')
                )
                    return;

                if (record.status === 'Needs you')
                    records.resumeFromUser(
                        workId,
                        record.revision,
                        record.buildBranch ||
                            record.buildPhase ||
                            records.threads(workId).some((t) => t.purpose === 'build')
                            ? 'In progress'
                            : 'Shaping',
                    );
                else if (record.needsYou) records.clearNeedsYou(workId, record.revision);
            }),
    };
}
