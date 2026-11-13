import type { DatabaseSync } from 'node:sqlite';

/** Only field names and revisions are retained: no historical bodies or provider data. */
export function installWriteJournal(db: DatabaseSync): void {
    db.exec(`
      CREATE TABLE write_origins(entity TEXT, id TEXT, revision INTEGER NOT NULL, PRIMARY KEY(entity,id)) STRICT;
      CREATE TABLE write_fields(entity TEXT, id TEXT, field TEXT, revision INTEGER NOT NULL, PRIMARY KEY(entity,id,field)) STRICT;
      CREATE TABLE write_dirty(entity TEXT, id TEXT, field TEXT, PRIMARY KEY(entity,id,field)) STRICT;
    `);

    const dirty = (entity: string, id: string, field: string) =>
        `INSERT INTO write_dirty SELECT '${entity}',${id},${field} WHERE ${id} IS NOT NULL ON CONFLICT DO NOTHING;`;

    for (const [entity, table, key] of [
        ['work', 'work_records', 'work_id'],
        ['dependency', 'dependencies', 'dependency_id'],
    ]) {
        db.exec(`
          INSERT INTO write_origins SELECT '${entity}',${key},revision FROM ${table};
          CREATE TRIGGER journal_${table}_insert AFTER INSERT ON ${table} BEGIN
            INSERT INTO write_origins VALUES ('${entity}',NEW.${key},NEW.revision);
          END;
          CREATE TRIGGER journal_${table}_delete AFTER DELETE ON ${table} BEGIN
            DELETE FROM write_origins WHERE entity='${entity}' AND id=OLD.${key};
            DELETE FROM write_fields WHERE entity='${entity}' AND id=OLD.${key};
          END;
        `);
        for (const row of db.prepare(`PRAGMA table_info(${table})`).all()) {
            const column = String(row.name);

            if ([key, 'revision', 'updated_at', 'created_at'].includes(column)) continue;

            const field = column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

            db.exec(`CREATE TRIGGER journal_${table}_${column} AFTER UPDATE OF ${column} ON ${table}
              WHEN OLD.${column} IS NOT NEW.${column} BEGIN ${dirty(entity!, `NEW.${key}`, `'${field}'`)} END;`);
        }
    }

    // Related rows are changed both before and after their owner's revision bump.
    // Collect them here and assign their final revision at the transaction boundary.
    const related = (
        table: string,
        targets: (row: string) => { entity: string; id: string; field: string }[],
        changed?: string,
    ) => {
        for (const event of ['INSERT', 'UPDATE', 'DELETE']) {
            const rows = event === 'UPDATE' ? ['OLD', 'NEW'] : [event === 'DELETE' ? 'OLD' : 'NEW'];
            const statements = rows.flatMap((row) =>
                targets(row).map(({ entity, id, field }) => dirty(entity, id, field)),
            );

            db.exec(
                `CREATE TRIGGER journal_related_${table}_${event} AFTER ${event} ON ${table}${event === 'UPDATE' && changed ? ` WHEN ${changed}` : ''} BEGIN ${statements.join('\n')} END;`,
            );
        }
    };

    related('bodies', (r) => [
        { entity: 'work', id: `${r}.work_id`, field: `'body.' || ${r}.body` },
        {
            entity: 'work',
            id: `(SELECT parent_id FROM work_records WHERE work_id=${r}.work_id AND ${r}.body IN ('answer','domain-drafts'))`,
            field: "'decisionAnswers'",
        },
    ]);
    related('decision_answers', (r) => [
        { entity: 'work', id: `${r}.work_id`, field: "'answerState'" },
        {
            entity: 'work',
            id: `(SELECT parent_id FROM work_records WHERE work_id=${r}.work_id)`,
            field: "'decisionAnswers'",
        },
    ]);
    related('blockers', (r) => [
        { entity: 'work', id: `${r}.work_id`, field: "'blockers'" },
        { entity: 'work', id: `${r}.blocker_id`, field: "'dependents'" },
    ]);
    db.exec(`CREATE TRIGGER journal_children_update AFTER UPDATE OF parent_id ON work_records
      WHEN OLD.parent_id IS NOT NEW.parent_id BEGIN
        ${dirty('work', 'OLD.parent_id', "'children'")}
        ${dirty('work', 'NEW.parent_id', "'children'")}
      END;
      CREATE TRIGGER journal_children_delete AFTER DELETE ON work_records BEGIN
        ${dirty('work', 'OLD.parent_id', "'children'")}
      END;`);
    for (const [table, field] of [
        ['review_rounds', 'reviewRounds'],
        ['review_axes', 'reviewRounds'],
        ['review_findings', 'reviewRounds'],
        ['brief_gates', 'gate'],
    ])
        related(table!, (r) => [{ entity: 'work', id: `${r}.work_id`, field: `'${field}'` }]);
    for (const [table, prefix, key] of [
        ['observations', 'observations', 'observed'],
        ['threads', 'threads', 'thread_id'],
        ['launch_intents', 'intents', 'intent_id'],
        ['run_settings', 'runSettings', 'run_id'],
        ['role_runs', 'roleRuns', 'execution_id'],
    ])
        related(table!, (r) => [{ entity: 'work', id: `${r}.work_id`, field: `'${prefix}.' || ${r}.${key}` }]);

    const dependencyContentChanged = db
        .prepare('PRAGMA table_info(dependencies)')
        .all()
        .map((row) => String(row.name))
        .filter((column) => !['revision', 'updated_at'].includes(column))
        .map((column) => `OLD.${column} IS NOT NEW.${column}`)
        .join(' OR ');

    related(
        'dependencies',
        (r) => [{ entity: 'work', id: `${r}.work_id`, field: "'dependencies'" }],
        dependencyContentChanged,
    );
    related('dependency_blocks', (r) => [
        { entity: 'dependency', id: `${r}.dependency_id`, field: "'blocks'" },
        { entity: 'work', id: `${r}.build_id`, field: "'dependencies'" },
    ]);
    related('dependency_observations', (r) => [
        { entity: 'dependency', id: `${r}.dependency_id`, field: `'observations.' || ${r}.subject` },
    ]);
}

/** Called inside the write transaction, after all mutations and revision bumps. */
export function flushWriteJournal(db: DatabaseSync): void {
    for (const [entity, table, key] of [
        ['work', 'work_records', 'work_id'],
        ['dependency', 'dependencies', 'dependency_id'],
    ])
        db.exec(`INSERT INTO write_fields SELECT d.entity,d.id,d.field,r.revision FROM write_dirty d
      JOIN ${table} r ON r.${key}=d.id WHERE d.entity='${entity}'
      ON CONFLICT(entity,id,field) DO UPDATE SET revision=excluded.revision;`);
    db.exec('DELETE FROM write_dirty');
}
