import type { Database } from './database.ts';
import type { WorkRecords } from './work-records.ts';

export interface UserWaitRecords {
    reconcileUserWait(workId: string, observation: { threadId: string; requestId?: string }): void;
}

/** Only an authoritative observation with the same owner and no request clears that question's notice. */
export function userWaitRecords(database: Database, get: () => WorkRecords): UserWaitRecords {
    const { db } = database;

    return {
        reconcileUserWait: (workId, { threadId, requestId }) =>
            database.write(() => {
                const records = get();
                const record = records.read(workId);

                if (record.setAside || record.finishedAt) return;

                const wait = db.prepare('SELECT * FROM owner_waits WHERE work_id=?').get(workId);

                if (requestId) {
                    // Older question instructions saved the notice before opening T3's UI. Bind that notice
                    // when the request appears, too; observing it one poll earlier does not make it unrelated.
                    if (record.needsYouCauses.length || /approve.*brief|brief.*approval/i.test(record.needsYou ?? ''))
                        return;

                    db.prepare(
                        'INSERT INTO owner_waits VALUES (?,?,?,?) ON CONFLICT(work_id) DO UPDATE SET thread_id=excluded.thread_id,request_id=excluded.request_id,notice=excluded.notice WHERE owner_waits.thread_id<>excluded.thread_id OR owner_waits.request_id<>excluded.request_id OR owner_waits.notice IS NOT excluded.notice',
                    ).run(workId, threadId, requestId, record.needsYou);

                    return;
                }

                if (!wait || wait.request_id === '') {
                    if (wait) db.prepare('DELETE FROM owner_waits WHERE work_id=?').run(workId);

                    return;
                }

                if (wait.thread_id !== threadId) return;

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
