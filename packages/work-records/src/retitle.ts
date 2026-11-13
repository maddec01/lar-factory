import { WorkRecordError, type Database } from './database.ts';
import type { WorkRecord } from './work-records.ts';

interface TitleChange {
    workId: string;
    revision: number;
    previous: string;
    title: string;
    pending: boolean;
    error: string | null;
    retryAfter: number;
}
export interface RetitleRecords {
    retitle(workId: string, revision: number, title: string): WorkRecord;
    titleHistory(workId: string): TitleChange[];
    titleProjections(): TitleChange[];
    settleTitleProjection(workId: string, revision: number, failure?: string): void;
}

export function retitleRecords(database: Database, read: (id: string) => WorkRecord): RetitleRecords {
    const { db } = database;
    const history = (workId: string): TitleChange[] => {
        read(workId);

        return db
            .prepare('SELECT content FROM title_changes WHERE work_id = ? ORDER BY revision')
            .all(workId)
            .map((row) => JSON.parse(String(row.content)) as TitleChange);
    };

    return {
        retitle: (workId, revision, title) =>
            database.write(() => {
                if (typeof title !== 'string' || !title.trim() || /[\r\n]/.test(title))
                    throw new WorkRecordError('invalid', 'A title must be nonempty text on one line.');

                if (!Number.isSafeInteger(revision) || revision < 1)
                    throw new WorkRecordError('invalid', 'The revision must be a whole number from 1.');

                const record = read(workId);

                if (record.revision !== revision)
                    throw new WorkRecordError(
                        'stale-revision',
                        `The work record ${workId} is at revision ${record.revision}, not ${revision}; read it again and retry.`,
                    );

                const next = title.trim();

                if (next === record.title) return record;

                // Older requests remain historical; only the current title may be projected.
                for (const change of history(workId)) {
                    if (change.pending)
                        db.prepare('UPDATE title_changes SET content = ? WHERE work_id = ? AND revision = ?').run(
                            JSON.stringify({ ...change, pending: false }),
                            workId,
                            change.revision,
                        );
                }

                const change: TitleChange = {
                    workId,
                    revision: revision + 1,
                    previous: record.title,
                    title: next,
                    pending: Boolean(record.ticket),
                    error: null,
                    retryAfter: 0,
                };

                db.prepare('INSERT INTO title_changes(work_id, revision, content) VALUES (?, ?, ?)').run(
                    workId,
                    change.revision,
                    JSON.stringify(change),
                );
                db.prepare(
                    'UPDATE work_records SET title = ?, revision = revision + 1, updated_at = ? WHERE work_id = ?',
                ).run(next, new Date().toISOString(), workId);

                return read(workId);
            }),
        titleHistory: (workId) => database.read(() => history(workId)),
        titleProjections: () =>
            database.read(() =>
                db
                    .prepare("SELECT content FROM title_changes WHERE json_extract(content, '$.pending') = 1")
                    .all()
                    .map((row) => JSON.parse(String(row.content)) as TitleChange),
            ),
        settleTitleProjection: (workId, revision, failure) =>
            database.write(() => {
                const change = history(workId).find((entry) => entry.revision === revision);

                if (!change?.pending) return;

                db.prepare('UPDATE title_changes SET content = ? WHERE work_id = ? AND revision = ?').run(
                    JSON.stringify({
                        ...change,
                        pending: failure !== undefined,
                        error: failure ?? null,
                        retryAfter: failure === undefined ? 0 : Date.now() + 30_000,
                    }),
                    workId,
                    revision,
                );
            }),
    };
}
