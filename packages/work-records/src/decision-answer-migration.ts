import type { DatabaseSync } from 'node:sqlite';

/** Preserve existing answers and completion when upgrading; their original record revision is unknown. */
export function migrateDecisionAnswers(db: DatabaseSync): void {
    db.exec(`ALTER TABLE work_records ADD COLUMN answer_state TEXT;
        CREATE TABLE decision_answers(work_id TEXT NOT NULL REFERENCES work_records(work_id) ON DELETE CASCADE,answer_revision INTEGER NOT NULL,content TEXT NOT NULL,PRIMARY KEY(work_id,answer_revision)) STRICT`);
    for (const row of db
        .prepare(
            "SELECT w.work_id,w.parent_id,b.markdown,b.written FROM work_records w JOIN bodies b ON b.work_id=w.work_id AND b.body='answer' WHERE w.kind='decision'",
        )
        .all()) {
        const map = db
            .prepare(
                "SELECT b.written,w.revision FROM bodies b JOIN work_records w ON b.work_id=w.work_id WHERE b.work_id=? AND b.body='map'",
            )
            .get(row.parent_id ?? '');
        const drafts = db
            .prepare("SELECT written FROM bodies WHERE work_id=? AND body='domain-drafts'")
            .get(row.work_id!);
        const incorporation =
            map && drafts && Number(map.written) > Math.max(Number(row.written), Number(drafts.written))
                ? {
                      conceptId: row.parent_id,
                      mapRevision: Number(map.revision),
                      draftsWritten: Number(drafts.written),
                      replacementKey: null,
                  }
                : null;
        const state = { revision: 1, current: true, supersededBy: null, incorporation };

        db.prepare('INSERT INTO decision_answers(work_id,answer_revision,content) VALUES (?,1,?)').run(
            row.work_id!,
            JSON.stringify({
                ...state,
                text: row.markdown,
                sourceRevision: null,
                recordedAt: new Date().toISOString(),
            }),
        );
        db.prepare('UPDATE work_records SET answer_state=? WHERE work_id=?').run(JSON.stringify(state), row.work_id!);
    }
}
