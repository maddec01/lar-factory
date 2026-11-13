import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { WorkRecordError, type Database } from './database.ts';
import { expectRevision } from './record-revision.ts';
import type { WorkRecord } from './work-records.ts';

type AnswerReference =
    | { kind: 'decision'; workId: string; answerRevision: number }
    | { kind: 'gate'; workId: string; gateId: string };
interface Incorporation {
    conceptId: string;
    mapRevision: number;
    draftsWritten: number;
    replacementKey: string | null;
}
export interface DecisionAnswerState {
    revision: number;
    current: boolean;
    supersededBy: AnswerReference | null;
    incorporation: Incorporation | null;
}
interface AnswerVersion extends DecisionAnswerState {
    text: string;
    sourceRevision: number | null;
    recordedAt: string;
}
interface CurrentReplacement {
    kind: 'decision' | 'gate';
    workId: string;
    text: string;
    answerRevision?: number;
    gateId?: string;
}
interface Supersession {
    answerRevision: number;
    by: AnswerReference & { revision: number };
    affected: { workId: string; revision: number }[];
}
export interface DecisionAnswers {
    decisionAnswer(workId: string): {
        current: AnswerVersion | null;
        supersededBy: AnswerReference | null;
        replacement: CurrentReplacement | null;
    };
    answerHistory(workId: string): AnswerVersion[];
    supersedeAnswer(workId: string, revision: number, input: Supersession): WorkRecord;
}

function versions(db: DatabaseSync, workId: string): AnswerVersion[] {
    return db
        .prepare('SELECT content FROM decision_answers WHERE work_id=? ORDER BY answer_revision')
        .all(workId)
        .map((row) => JSON.parse(String(row.content)) as AnswerVersion);
}

function save(db: DatabaseSync, workId: string, version: AnswerVersion): void {
    db.prepare(
        'INSERT INTO decision_answers(work_id,answer_revision,content) VALUES (?,?,?) ON CONFLICT DO UPDATE SET content=excluded.content',
    ).run(workId, version.revision, JSON.stringify(version));

    const { revision, current, supersededBy, incorporation } = version;

    db.prepare('UPDATE work_records SET answer_state=? WHERE work_id=?').run(
        JSON.stringify({ revision, current, supersededBy, incorporation }),
        workId,
    );
}

function resolveReference(
    db: DatabaseSync,
    reference: AnswerReference,
    visited = new Set<string>(),
): CurrentReplacement | null {
    const record = db.prepare('SELECT set_aside_at FROM work_records WHERE work_id=?').get(reference.workId);

    if (!record || record.set_aside_at) return null;

    const key = JSON.stringify(reference);

    if (visited.has(key)) return null;

    visited.add(key);

    if (reference.kind === 'decision') {
        const version = versions(db, reference.workId).find((answer) => answer.revision === reference.answerRevision);

        return version?.current
            ? { kind: 'decision', workId: reference.workId, text: version.text, answerRevision: version.revision }
            : version?.supersededBy
              ? resolveReference(db, version.supersededBy, visited)
              : null;
    }

    const gate = db
        .prepare(
            "SELECT brief_digest FROM brief_gates WHERE work_id=? AND gate_id=? AND invalidated=0 AND source IN ('gate','user')",
        )
        .get(reference.workId, reference.gateId);
    const body = db
        .prepare("SELECT markdown,has_passing_gate FROM bodies WHERE work_id=? AND body='brief'")
        .get(reference.workId);

    if (
        !gate ||
        !body?.has_passing_gate ||
        gate.brief_digest !== createHash('sha256').update(JSON.stringify(body.markdown)).digest('hex')
    )
        return null;

    return { kind: 'gate', workId: reference.workId, text: String(body.markdown), gateId: reference.gateId };
}

const replacementKey = (replacement: CurrentReplacement | null): string | null =>
    replacement
        ? JSON.stringify([replacement.kind, replacement.workId, replacement.answerRevision ?? replacement.gateId])
        : null;

/** A later change to the replacing answer/gate reopens incorporation too. */
export function decisionAnswerIncorporated(
    db: DatabaseSync,
    state: DecisionAnswerState,
    draftsWritten: number,
): boolean {
    const replacement = state.supersededBy ? resolveReference(db, state.supersededBy) : null;

    return Boolean(
        state.incorporation &&
        state.incorporation.draftsWritten === draftsWritten &&
        (state.current || (replacement && state.incorporation.replacementKey === replacementKey(replacement))),
    );
}

/** Inside setBody's transaction, old text becomes immutable history with an explicit replacement. */
export function recordDecisionAnswer(db: DatabaseSync, workId: string, sourceRevision: number, text: string): void {
    const previous = versions(db, workId).at(-1);
    const revision = (previous?.revision ?? 0) + 1;

    if (previous?.current)
        save(db, workId, {
            ...previous,
            current: false,
            supersededBy: { kind: 'decision', workId, answerRevision: revision },
            incorporation: null,
        });

    save(db, workId, {
        revision,
        current: true,
        supersededBy: null,
        incorporation: null,
        text,
        sourceRevision,
        recordedAt: new Date().toISOString(),
    });
}

/** The map write incorporates exact current answer versions (including supersession references). */
export function incorporateDecisionAnswers(db: DatabaseSync, conceptId: string, mapRevision: number): string[] {
    const touched: string[] = [];

    for (const child of db
        .prepare("SELECT work_id FROM work_records WHERE parent_id=? AND kind='decision' AND set_aside_at IS NULL")
        .all(conceptId)) {
        const workId = String(child.work_id);
        const version = versions(db, workId).at(-1);
        const drafts = db.prepare("SELECT written FROM bodies WHERE work_id=? AND body='domain-drafts'").get(workId);

        if (!version || !drafts) continue;

        save(db, workId, {
            ...version,
            incorporation: {
                conceptId,
                mapRevision,
                draftsWritten: Number(drafts.written),
                replacementKey: version.supersededBy
                    ? replacementKey(resolveReference(db, version.supersededBy))
                    : null,
            },
        });
        touched.push(workId);
    }

    return touched;
}

export function decisionAnswers(database: Database, read: (id: string) => WorkRecord): DecisionAnswers {
    const { db } = database;
    const history = (workId: string) => {
        if (read(workId).kind !== 'decision')
            throw new WorkRecordError('invalid', 'Only a decision has answer versions.');

        return versions(db, workId);
    };

    return {
        decisionAnswer: (workId) =>
            database.read(() => {
                const latest = history(workId).at(-1);

                return {
                    current: latest?.current ? latest : null,
                    supersededBy: latest?.supersededBy ?? null,
                    replacement: latest?.supersededBy ? resolveReference(db, latest.supersededBy) : null,
                };
            }),
        answerHistory: (workId) => database.read(() => history(workId)),
        supersedeAnswer: (workId, revision, input) =>
            database.write(() => {
                const record = read(workId);

                expectRevision(record, revision);

                const latest = history(workId).at(-1);

                if (!input || !latest?.current || latest.revision !== input.answerRevision)
                    throw new WorkRecordError(
                        'stale-revision',
                        'Read the current decision answer before superseding its exact revision.',
                    );

                if (
                    !input.by ||
                    !Array.isArray(input.affected) ||
                    input.affected.some((item) => !item || typeof item.workId !== 'string')
                )
                    throw new WorkRecordError('invalid', 'Supersession needs by and an explicit affected-build list.');

                const replacement = read(input.by.workId);

                expectRevision(replacement, input.by.revision);

                if (replacement.setAside || replacement.parentId !== record.parentId)
                    throw new WorkRecordError('invalid', 'The replacement must be active in the same destination.');

                let reference: AnswerReference;

                if (input.by.kind === 'decision') {
                    const answer = history(replacement.workId).at(-1);

                    if (
                        !answer?.current ||
                        answer.revision !== input.by.answerRevision ||
                        replacement.workId === workId
                    )
                        throw new WorkRecordError('invalid', 'Name another decision’s exact current answer revision.');

                    reference = { kind: 'decision', workId: replacement.workId, answerRevision: answer.revision };
                } else if (input.by.kind === 'gate') {
                    const gate = db
                        .prepare(
                            "SELECT gate_id,brief_digest FROM brief_gates WHERE work_id=? AND gate_id=? AND invalidated=0 AND source IN ('gate','user')",
                        )
                        .get(replacement.workId, input.by.gateId);
                    const current = db
                        .prepare("SELECT has_passing_gate FROM bodies WHERE work_id=? AND body='brief'")
                        .get(replacement.workId);

                    if (
                        !gate ||
                        !current?.has_passing_gate ||
                        !resolveReference(db, { kind: 'gate', workId: replacement.workId, gateId: input.by.gateId })
                    )
                        throw new WorkRecordError('invalid', 'Name the replacing build’s current passing gate.');

                    reference = { kind: 'gate', workId: replacement.workId, gateId: input.by.gateId };
                } else
                    throw new WorkRecordError(
                        'invalid',
                        'A superseding reference must name a decision answer or gate.',
                    );

                const touched = new Set<string>(record.parentId ? [record.parentId] : []);

                for (const affected of input.affected) {
                    const build = read(affected.workId);

                    expectRevision(build, affected.revision);

                    if (
                        build.kind !== 'build' ||
                        build.parentId !== record.parentId ||
                        build.buildPhase ||
                        build.pullRequest ||
                        build.setAside ||
                        build.workId === replacement.workId
                    )
                        throw new WorkRecordError(
                            'invalid',
                            `Affected build ${build.workId} needs separate reconciliation or is the replacement itself.`,
                        );

                    touched.add(build.workId);
                }
                save(db, workId, { ...latest, current: false, supersededBy: reference, incorporation: null });
                for (const affected of input.affected) {
                    db.prepare('UPDATE brief_gates SET invalidated=1 WHERE work_id=?').run(affected.workId);
                    db.prepare("UPDATE bodies SET has_passing_gate=0 WHERE work_id=? AND body='brief'").run(
                        affected.workId,
                    );
                    db.prepare(
                        "UPDATE work_records SET status=CASE WHEN status='Ready' THEN 'Shaping' ELSE status END WHERE work_id=?",
                    ).run(affected.workId);
                }
                touched.add(workId);
                for (const id of touched)
                    db.prepare('UPDATE work_records SET revision=revision+1,updated_at=? WHERE work_id=?').run(
                        new Date().toISOString(),
                        id,
                    );

                return read(workId);
            }),
    };
}
