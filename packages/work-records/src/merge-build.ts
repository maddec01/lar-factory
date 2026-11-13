import { validateBlockers } from './blocker-graph.ts';
import { WorkRecordError, type Database } from './database.ts';
import { expectRevision } from './record-revision.ts';
import type { Body, WorkRecord } from './work-records.ts';

interface BuildMerge {
    into: string;
    /** Every affected work record: survivor, incoming/outgoing endpoints and parent. */
    revisions: Record<string, number>;
    dependencyRevisions?: Record<string, number>;
}
export interface MergeBuildRecords {
    mergeBuild(workId: string, revision: number, input: BuildMerge): { source: WorkRecord; target: WorkRecord };
}
interface Storage {
    read(id: string): WorkRecord;
    body(id: string, body: Body): string | null;
    initialContext(id: string): string;
    writeBody(id: string, body: Body, text: string): void;
}

/** Contract two proposed builds atomically, preserving both records and their tickets. */
export function mergeBuildRecords(database: Database, storage: Storage): MergeBuildRecords {
    const { db } = database;
    const refuse = (message: string): never => {
        throw new WorkRecordError('invalid', message);
    };

    return {
        mergeBuild: (workId, revision, input) =>
            database.write(() => {
                const source = storage.read(workId);

                expectRevision(source, revision);

                if (!input || typeof input.into !== 'string' || !input.revisions || Array.isArray(input.revisions))
                    refuse('A merge needs into and affected-record revisions.');

                const target = storage.read(input.into);

                if (source.workId === target.workId) refuse('A build cannot be merged into itself.');

                for (const record of [source, target]) {
                    if (
                        record.kind !== 'build' ||
                        record.setAside ||
                        record.finishedAt ||
                        record.supersededBy ||
                        record.buildPhase ||
                        record.pullRequest ||
                        !['List', 'Queued', 'Shaping', 'Needs you', 'Ready'].includes(record.status)
                    )
                        refuse(
                            `Only proposed builds can merge; ${record.workId} is active, retired or not a build. Reconcile active work separately.`,
                        );

                    if (db.prepare('SELECT 1 FROM work_records WHERE parent_id = ?').get(record.workId))
                        refuse('A proposed build with implementation slices cannot merge.');
                }

                if (
                    source.parentId !== target.parentId ||
                    source.repository.toLowerCase() !== target.repository.toLowerCase()
                )
                    refuse('Merged proposed builds must share a destination and repository.');

                const edges = db
                    .prepare('SELECT work_id,blocker_id FROM blockers WHERE work_id IN (?,?) OR blocker_id = ?')
                    .all(workId, target.workId, workId);
                const touched = new Set<string>([target.workId, ...(source.parentId ? [source.parentId] : [])]);

                for (const edge of edges) {
                    touched.add(String(edge.work_id));
                    touched.add(String(edge.blocker_id));
                }
                touched.delete(workId);
                for (const id of touched) {
                    const record = storage.read(id);

                    expectRevision(record, input.revisions[id]!);

                    if (
                        id !== target.workId &&
                        edges.some((edge) => edge.work_id === id && edge.blocker_id === workId) &&
                        (record.buildPhase || record.pullRequest)
                    )
                        refuse(`Dependent ${id} is active; hold it for reconciliation before redirecting its blocker.`);
                }

                const dependencies = db
                    .prepare(
                        'SELECT d.dependency_id,d.revision FROM dependency_blocks b JOIN dependencies d ON d.dependency_id=b.dependency_id WHERE b.build_id = ?',
                    )
                    .all(workId);

                for (const dependency of dependencies) {
                    if (input.dependencyRevisions?.[String(dependency.dependency_id)] !== Number(dependency.revision))
                        throw new WorkRecordError(
                            'stale-revision',
                            `Read Dependency ${String(dependency.dependency_id)} again and supply its current dependencyRevisions entry.`,
                        );
                }
                db.prepare('DELETE FROM blockers WHERE work_id = ? OR blocker_id = ?').run(workId, workId);
                for (const edge of edges) {
                    const dependent = String(edge.work_id) === workId ? target.workId : String(edge.work_id);
                    const prerequisite = String(edge.blocker_id) === workId ? target.workId : String(edge.blocker_id);

                    if (dependent !== prerequisite)
                        db.prepare('INSERT OR IGNORE INTO blockers(work_id,blocker_id) VALUES (?,?)').run(
                            dependent,
                            prerequisite,
                        );
                }
                validateBlockers(db);
                for (const dependency of dependencies) {
                    if (
                        db
                            .prepare('INSERT OR IGNORE INTO dependency_blocks(dependency_id,build_id) VALUES (?,?)')
                            .run(dependency.dependency_id!, target.workId).changes
                    )
                        db.prepare(
                            'UPDATE dependencies SET revision=revision+1,updated_at=? WHERE dependency_id=?',
                        ).run(new Date().toISOString(), dependency.dependency_id!);
                }

                const context = storage.initialContext(workId);
                const brief = storage.body(workId, 'brief');
                const absorbed = `\n\n## Absorbed proposed build: ${source.title}\n\nSource: ${workId}${source.ticket ? ` (${source.ticket})` : ''}\n\n${context}${context && brief ? '\n\n' : ''}${brief ?? ''}`;

                storage.writeBody(target.workId, 'brief', `${storage.body(target.workId, 'brief') ?? ''}${absorbed}`);
                db.prepare('UPDATE brief_gates SET invalidated=1 WHERE work_id=?').run(target.workId);
                db.prepare("UPDATE bodies SET has_passing_gate=0 WHERE work_id=? AND body='brief'").run(target.workId);

                const at = new Date().toISOString();

                db.prepare(
                    'UPDATE work_records SET superseded_by=?,set_aside_at=?,revision=revision+1,updated_at=? WHERE work_id=?',
                ).run(target.workId, at, at, workId);
                db.prepare(
                    "UPDATE work_records SET status=CASE WHEN status='Ready' THEN 'Shaping' ELSE status END WHERE work_id=?",
                ).run(target.workId);
                for (const id of touched)
                    db.prepare('UPDATE work_records SET revision=revision+1,updated_at=? WHERE work_id=?').run(at, id);

                return { source: storage.read(workId), target: storage.read(target.workId) };
            }),
    };
}
