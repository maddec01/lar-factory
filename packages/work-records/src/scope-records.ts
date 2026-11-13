import { checkBriefScope, parseBriefScope, type BriefScope, type ScopeCheck } from './brief-scope.ts';
import { WorkRecordError, type Database } from './database.ts';
import type { WorkRecord } from './work-records.ts';

export interface ConfirmedScope {
    scope: BriefScope;
    sourceRevision: number;
    title: string;
    context: string;
    confirmedBy: string;
    response: string;
    confirmedAt: string;
}
export interface ScopeRecords {
    confirmedScope(id: string): ConfirmedScope | null;
    confirmScope(id: string, revision: number, scope: unknown, by: string, response: string): ConfirmedScope;
    briefScopeCheck(id: string): ScopeCheck;
}

export function storedScope(database: Database, id: string): ConfirmedScope | null {
    const row = database.db
        .prepare('SELECT content FROM confirmed_scopes WHERE work_id=? ORDER BY revision DESC LIMIT 1')
        .get(id);

    return row ? (JSON.parse(String(row.content)) as ConfirmedScope) : null;
}

export function scopeRecords(database: Database, read: (id: string) => WorkRecord): ScopeRecords {
    const { db } = database;

    return {
        confirmedScope: (id) =>
            database.read(() => {
                read(id);

                return storedScope(database, id);
            }),
        confirmScope: (id, revision, input, by, response) =>
            database.write(() => {
                const record = read(id);
                const scope = parseBriefScope(input);

                if (!Number.isSafeInteger(revision) || revision !== record.revision)
                    throw new WorkRecordError(
                        'stale-revision',
                        'The work changed. Read it again before confirming scope.',
                    );

                if (!by?.trim() || !response?.trim() || by.length > 200 || response.length > 10000)
                    throw new WorkRecordError(
                        'invalid',
                        'Name the confirmer and their explicit understanding response.',
                    );

                const previous = storedScope(database, id);

                if (previous && JSON.stringify(previous.scope) === JSON.stringify(scope)) return previous;

                const context = db.prepare('SELECT initial_context FROM work_records WHERE work_id=?').get(id);
                const confirmed: ConfirmedScope = {
                    scope,
                    sourceRevision: revision,
                    title: record.title,
                    context: String(context!.initial_context),
                    confirmedBy: by.trim(),
                    response: response.trim(),
                    confirmedAt: new Date().toISOString(),
                };

                db.prepare('INSERT INTO confirmed_scopes(work_id,revision,content) VALUES(?,?,?)').run(
                    id,
                    revision,
                    JSON.stringify(confirmed),
                );
                db.prepare('UPDATE brief_gates SET invalidated=1 WHERE work_id=?').run(id);
                db.prepare("UPDATE bodies SET has_passing_gate=0 WHERE work_id=? AND body='brief'").run(id);
                db.prepare('UPDATE work_records SET revision=revision+1,updated_at=? WHERE work_id=?').run(
                    confirmed.confirmedAt,
                    id,
                );

                return confirmed;
            }),
        briefScopeCheck: (id) =>
            database.read(() => {
                read(id);

                const scope = storedScope(database, id);

                if (!scope)
                    throw new WorkRecordError(
                        'invalid',
                        'No confirmed scope. Run confirm-scope at understanding confirmation.',
                    );

                const body = db.prepare("SELECT markdown FROM bodies WHERE work_id=? AND body='brief'").get(id);

                return checkBriefScope(scope.scope, body ? String(body.markdown) : null);
            }),
    };
}
