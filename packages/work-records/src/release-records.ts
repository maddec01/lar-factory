import type { ReleaseEvidence, ReleasePlan } from '@lar-factory/shared';

import { WorkRecordError, type Database } from './database.ts';
import type { WorkRecord } from './work-records.ts';

export interface ReleaseRecords {
    releasePlan(id: string): ReleasePlan | null;
    setReleasePlan(id: string, revision: number, input: unknown): ReleasePlan;
    completeReleaseStep(id: string, revision: number, stepId: string, by: string, evidence: string): ReleasePlan;
    recordOutcomeCheck(
        id: string,
        revision: number,
        result: 'passed' | 'failed',
        by: string,
        evidence: string,
        inputDigest?: string,
    ): ReleasePlan;
}

const invalid = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};
const text = (value: unknown, limit = 4000): string =>
    typeof value === 'string' && value.trim() && value.length <= limit && !value.includes('\0')
        ? value.trim()
        : invalid('Release text must be nonempty and within its length limit.');
const object = (value: unknown, keys: string[], optional: string[] = []): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('Expected a release plan object.');

    const result = value as Record<string, unknown>;

    if (
        Object.keys(result).some((key) => ![...keys, ...optional].includes(key)) ||
        keys.some((key) => !Object.hasOwn(result, key))
    )
        invalid(`Expected release fields: ${keys.join(', ')}.`);

    return result;
};

export function storedRelease(database: Database, id: string): ReleasePlan | null {
    const row = database.db
        .prepare('SELECT content FROM release_plans WHERE work_id=? ORDER BY revision DESC LIMIT 1')
        .get(id);

    return row ? (JSON.parse(String(row.content)) as ReleasePlan) : null;
}
/** Release evidence cannot complete a plan whose delivery members were removed or retired. */
export function releaseMemberHolds(database: Database, id: string): string[] {
    return (storedRelease(database, id)?.steps ?? [])
        .filter((step) =>
            step.shipsWith?.some(
                (member) =>
                    !database.db
                        .prepare(
                            "SELECT 1 FROM work_records WHERE work_id = ? AND parent_id = ? AND kind = 'build' AND set_aside_at IS NULL",
                        )
                        .get(member, id),
            ),
        )
        .map((step) => `Release step ${step.id}: reconcile removed or set-aside ships-with members.`);
}
export function releaseRecords(
    database: Database,
    read: (id: string) => WorkRecord,
    validateOutcome: (id: string, digest?: string) => void,
    queueContinuation: (id: string) => unknown,
): ReleaseRecords {
    const { db } = database;
    const save = (id: string, revision: number, change: (current: ReleasePlan | null) => ReleasePlan) =>
        database.write(() => {
            const record = read(id);

            if (!Number.isSafeInteger(revision) || revision !== record.revision)
                throw new WorkRecordError(
                    'stale-revision',
                    'The parent changed. Read it before recording release evidence.',
                );

            if (
                record.setAside ||
                (record.kind !== 'concept' &&
                    !db
                        .prepare(
                            "SELECT 1 FROM work_records WHERE parent_id=? AND kind IN ('build','decision') LIMIT 1",
                        )
                        .get(id))
            )
                invalid('Release steps belong to a linked-work or concept parent.');

            const current = storedRelease(database, id);
            const plan = change(current ? structuredClone(current) : null);

            if (JSON.stringify(plan) === JSON.stringify(current)) return plan;

            db.prepare('INSERT INTO release_plans(work_id,revision,content) VALUES(?,?,?)').run(
                id,
                revision,
                JSON.stringify(plan),
            );
            db.prepare(
                "UPDATE work_records SET revision=revision+1,updated_at=?,finished_at=NULL,status=CASE WHEN status='Done' THEN 'In progress' ELSE status END WHERE work_id=?",
            ).run(new Date().toISOString(), id);

            return plan;
        });
    const evidence = (by: string, proof: string): ReleaseEvidence => ({
        by: text(by, 200),
        evidence: text(proof, 10000),
        at: new Date().toISOString(),
    });
    const required = (plan: ReleasePlan | null): ReleasePlan =>
        plan ?? invalid('Record the parent release plan first.');

    return {
        releasePlan: (id) =>
            database.read(() => {
                read(id);

                return storedRelease(database, id);
            }),
        setReleasePlan: (id, revision, input) =>
            save(id, revision, (current) => {
                const value = object(input, ['steps', 'outcomeCheck']);

                if (!Array.isArray(value.steps) || value.steps.length > 100)
                    invalid('Release steps must be an ordered list of at most 100 entries.');

                const steps = (value.steps as unknown[]).map((entry) => {
                    const step = object(entry, ['id', 'who', 'what'], ['shipsWith']);

                    if (
                        step.shipsWith !== undefined &&
                        (!Array.isArray(step.shipsWith) ||
                            step.shipsWith.length < 2 ||
                            new Set(step.shipsWith).size !== step.shipsWith.length ||
                            step.shipsWith.some(
                                (member) =>
                                    typeof member !== 'string' ||
                                    !db
                                        .prepare(
                                            "SELECT 1 FROM work_records WHERE work_id = ? AND parent_id = ? AND kind = 'build' AND set_aside_at IS NULL",
                                        )
                                        .get(member, id),
                            ))
                    )
                        invalid('A ships-with release step needs at least two active delivery members of this group.');

                    return {
                        id: text(step.id, 100),
                        who: text(step.who, 200),
                        what: text(step.what),
                        done: null,
                        ...(step.shipsWith === undefined ? {} : { shipsWith: step.shipsWith as string[] }),
                    };
                });

                if (new Set(steps.map((step) => step.id)).size !== steps.length)
                    invalid('Release step IDs must be unique.');

                const what = text(value.outcomeCheck);

                if (
                    current &&
                    JSON.stringify(steps.map(({ done: _, ...step }) => step)) ===
                        JSON.stringify(current.steps.map(({ done: _, ...step }) => step)) &&
                    current.outcomeCheck.what === what
                )
                    return current;

                // A changed plan requires fresh release and Outcome evidence; old versions remain in history.
                return { steps, outcomeCheck: { what, result: 'pending', evidence: null } };
            }),
        completeReleaseStep: (id, revision, stepId, by, proof) =>
            database.write(() => {
                const plan = save(id, revision, (current) => {
                    const plan = required(current);
                    const index = plan.steps.findIndex((step) => step.id === stepId);

                    if (index < 0) invalid('Unknown release step ID.');

                    if (plan.steps.slice(0, index).some((step) => !step.done))
                        invalid('Complete preceding release steps first.');

                    if (
                        plan.steps[index]!.shipsWith?.some(
                            (member) =>
                                !db
                                    .prepare(
                                        "SELECT 1 FROM work_records WHERE work_id = ? AND parent_id = ? AND kind = 'build' AND set_aside_at IS NULL",
                                    )
                                    .get(member, id),
                        )
                    )
                        invalid('Reconcile removed release members before recording release evidence.');

                    const done = evidence(by, proof);

                    plan.steps[index]!.done = done;
                    plan.outcomeCheck.result = 'pending';
                    plan.outcomeCheck.evidence = null;

                    return plan;
                });

                queueContinuation(id);

                return plan;
            }),
        recordOutcomeCheck: (id, revision, result, by, proof, inputDigest) =>
            save(id, revision, (current) => {
                const plan = required(current);

                if (releaseMemberHolds(database, id).length)
                    invalid('Reconcile removed release members before checking the Outcome.');

                if (!['passed', 'failed'].includes(result)) invalid('Outcome check result must be passed or failed.');

                if (plan.steps.some((step) => !step.done))
                    invalid('Complete every release step before checking the Outcome.');

                validateOutcome(id, inputDigest);
                plan.outcomeCheck.result = result;
                plan.outcomeCheck.evidence = evidence(by, proof);

                return plan;
            }),
    };
}
