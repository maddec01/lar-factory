import { WorkRecordError, type Database } from './database.ts';

/** Resolve only known, disjoint changes. Store writers still compare-and-swap this revision. */
export function agentRevision(
    database: Database,
    id: string,
    revision: number,
    fields: readonly string[],
    entity: 'work' | 'dependency' = 'work',
): number {
    return database.read(() => {
        if (!Number.isSafeInteger(revision) || revision < 1)
            throw new WorkRecordError('invalid', 'Expected a positive whole revision.');

        const table = entity === 'work' ? 'work_records' : 'dependencies';
        const key = entity === 'work' ? 'work_id' : 'dependency_id';
        const current = database.db.prepare(`SELECT revision FROM ${table} WHERE ${key}=?`).get(id);

        if (!current) throw new WorkRecordError('not-found', `No ${entity} record has the ID "${id}".`);

        const latest = Number(current.revision);

        if (latest === revision) return revision;

        const origin = database.db
            .prepare('SELECT revision FROM write_origins WHERE entity=? AND id=?')
            .get(entity, id);
        const changed = database.db
            .prepare('SELECT field FROM write_fields WHERE entity=? AND id=? AND revision>? ORDER BY field')
            .all(entity, id, revision)
            .map((row) => String(row.field));
        const conflicts = changed.filter((field) =>
            fields.some((intent) => intent === '*' || field === intent || field.startsWith(`${intent}.`)),
        );
        const unavailable = !origin || revision < Number(origin.revision) || revision > latest;

        if (unavailable || conflicts.length)
            throw new WorkRecordError(
                'stale-revision',
                `The ${entity} record ${id} is at revision ${latest}, not ${revision}; ${unavailable ? 'field history is unavailable for that revision' : `conflicting fields: ${conflicts.join(', ')}`}. Reread the record and decide whether to reapply the write.`,
            );

        return latest;
    });
}
