import { validateBlockers } from './blocker-graph.ts';
import { WorkRecordError, type Database } from './database.ts';
import type { Body, NewWorkRecord, WorkRecord } from './work-records.ts';

/** A delivery part, distinct from the private slices used to implement a build. */
export interface NewPart {
    repository: string;
    parentId: string;
    parentRevision: number;
    title: string;
    body: string;
    kind: 'build' | 'decision';
    blockerIds: readonly string[];
}

interface PartStorage {
    /** These primitives run inside the caller's transaction. */
    insert(record: NewWorkRecord): WorkRecord;
    read(workId: string): WorkRecord;
    writeBody(workId: string, body: Body, markdown: string): void;
}

/** Creates the entire part and bumps its relationships together, or leaves the database unchanged. */
export function partCreator(database: Database, storage: PartStorage): (part: NewPart) => WorkRecord {
    const { db } = database;
    const attach = db.prepare('UPDATE work_records SET parent_id = ? WHERE work_id = ?');
    const block = db.prepare('INSERT INTO blockers (work_id, blocker_id) VALUES (?, ?)');
    const bump = db.prepare('UPDATE work_records SET revision = revision + 1, updated_at = ? WHERE work_id = ?');

    return (part) =>
        database.write(() => {
            if (part.kind !== 'build' && part.kind !== 'decision')
                throw new WorkRecordError('invalid', 'A delivery part must be a build or decision.');

            if (typeof part.body !== 'string' || !part.body.trim())
                throw new WorkRecordError('invalid', 'A delivery part needs a nonempty body.');

            if (!Number.isSafeInteger(part.parentRevision) || part.parentRevision < 1)
                throw new WorkRecordError('invalid', 'The parent revision must be a whole number from 1.');

            if (!Array.isArray(part.blockerIds) || part.blockerIds.some((id) => typeof id !== 'string' || !id))
                throw new WorkRecordError('invalid', 'The blockers must be a list of work IDs.');

            if (new Set(part.blockerIds).size !== part.blockerIds.length)
                throw new WorkRecordError('invalid', 'The blockers list contains a duplicate.');

            const parent = storage.read(part.parentId);

            if (parent.revision !== part.parentRevision)
                throw new WorkRecordError(
                    'stale-revision',
                    `The work record ${parent.workId} is at revision ${parent.revision}, not ${part.parentRevision}; read it again and retry.`,
                );

            if (!['concept', 'build', 'bug', 'feature', 'improvement', 'issue'].includes(parent.kind))
                throw new WorkRecordError('invalid', `A ${parent.kind} cannot own delivery parts.`);

            if (parent.setAside || parent.finishedAt)
                throw new WorkRecordError('invalid', 'Restore or reopen the parent before adding a delivery part.');

            const record = storage.insert({
                title: part.title,
                repository: part.repository,
                kind: part.kind,
                status: 'Queued',
            });

            attach.run(parent.workId, record.workId);
            storage.writeBody(record.workId, part.kind === 'decision' ? 'decision' : 'brief', part.body);
            for (const blockerId of part.blockerIds) {
                storage.read(blockerId);
                // The fresh ID has no incoming edges, so its prerequisites cannot introduce a cycle.
                block.run(record.workId, blockerId);
            }
            validateBlockers(db);
            for (const id of new Set([parent.workId, ...part.blockerIds])) bump.run(record.updatedAt, id);

            return storage.read(record.workId);
        });
}
