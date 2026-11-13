import { validateBlockers } from './blocker-graph.ts';
import { WorkRecordError, type Database } from './database.ts';
import { expectRevision } from './record-revision.ts';
import type { WorkRecord } from './work-records.ts';

export type DependentResolution = {
    workId: string;
    revision: number;
    reason: string;
} & ({ action: 'replace'; blockerId: string; blockerRevision: number } | { action: 'remove' | 'hold' });
export interface SetAsideRecords {
    setAside(workId: string, revision: number, dependents?: readonly DependentResolution[]): WorkRecord;
    setAsideHistory(workId: string): { at: string; dependents: readonly DependentResolution[] }[];
}

/** Reviews every incoming edge and commits its disposition with the retirement. */
export function setAsideRecords(database: Database, read: (id: string) => WorkRecord): SetAsideRecords {
    const { db } = database;

    return {
        setAside: (workId, revision, resolutions = []) =>
            database.write(() => {
                const record = read(workId);

                expectRevision(record, revision);

                if (record.setAside)
                    throw new WorkRecordError('invalid', `The work record ${workId} is already set aside.`);

                if (!Array.isArray(resolutions))
                    throw new WorkRecordError('invalid', 'Dependent resolutions must be a list.');

                const dependents = db
                    .prepare('SELECT work_id FROM blockers WHERE blocker_id = ?')
                    .all(workId)
                    .map((row) => String(row.work_id));

                if (
                    resolutions.length !== dependents.length ||
                    new Set(resolutions.map((item) => item?.workId)).size !== dependents.length ||
                    resolutions.some((item) => !dependents.includes(item?.workId))
                )
                    throw new WorkRecordError(
                        'invalid',
                        `Resolve every dependent of ${workId}: ${dependents.join(', ') || 'none'}. Each needs a replacement, removal reason or explicit hold.`,
                    );

                // Validate every revision before applying any part of the plan.
                for (const resolution of resolutions) {
                    const dependent = read(resolution.workId);

                    expectRevision(dependent, resolution.revision);

                    if (
                        typeof resolution.reason !== 'string' ||
                        !resolution.reason.trim() ||
                        !['replace', 'remove', 'hold'].includes(resolution.action)
                    )
                        throw new WorkRecordError('invalid', 'Each dependent needs an action and a nonempty reason.');

                    if (resolution.action !== 'hold' && (dependent.buildPhase || dependent.pullRequest))
                        throw new WorkRecordError(
                            'invalid',
                            `Active build ${dependent.workId} needs an explicit hold before reconciliation.`,
                        );

                    if (resolution.action === 'replace') {
                        const replacement = read(resolution.blockerId);

                        expectRevision(replacement, resolution.blockerRevision);

                        if (replacement.setAside || replacement.workId === workId)
                            throw new WorkRecordError('invalid', 'A replacement blocker must remain active.');
                    }
                }

                const touched = new Set<string>(record.parentId ? [record.parentId] : []);
                const at = new Date().toISOString();

                for (const resolution of resolutions) {
                    touched.add(resolution.workId);

                    if (resolution.action === 'hold') {
                        const dependent = read(resolution.workId);
                        const hold = `Set-aside ${workId}: ${resolution.reason}`;

                        db.prepare('UPDATE work_records SET needs_you = ? WHERE work_id = ?').run(
                            dependent.needsYou ? `${dependent.needsYou}\n${hold}` : hold,
                            resolution.workId,
                        );
                    } else {
                        db.prepare('DELETE FROM blockers WHERE work_id = ? AND blocker_id = ?').run(
                            resolution.workId,
                            workId,
                        );

                        if (resolution.action === 'replace') {
                            db.prepare('INSERT OR IGNORE INTO blockers(work_id,blocker_id) VALUES (?,?)').run(
                                resolution.workId,
                                resolution.blockerId,
                            );
                            touched.add(resolution.blockerId);
                        }
                    }
                }
                validateBlockers(db);
                db.prepare('INSERT INTO set_aside_changes(work_id,content) VALUES (?,?)').run(
                    workId,
                    JSON.stringify({ at, dependents: resolutions }),
                );
                db.prepare(
                    'UPDATE work_records SET set_aside_at = ?, revision = revision + 1, updated_at = ? WHERE work_id = ?',
                ).run(at, at, workId);
                for (const id of touched)
                    if (id !== workId)
                        db.prepare(
                            'UPDATE work_records SET revision = revision + 1, updated_at = ? WHERE work_id = ?',
                        ).run(at, id);

                return read(workId);
            }),
        setAsideHistory: (workId) =>
            database.read(() => {
                read(workId);

                return db
                    .prepare('SELECT content FROM set_aside_changes WHERE work_id = ? ORDER BY rowid')
                    .all(workId)
                    .map((row) => JSON.parse(String(row.content)) as { at: string; dependents: DependentResolution[] });
            }),
    };
}
