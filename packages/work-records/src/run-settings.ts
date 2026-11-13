import { executionMismatch, executionSettingsOf } from '@lar-factory/shared/execution-target';
import type {
    RoleRun,
    RoleRunFinish,
    RoleRunInput,
    RunSettings,
    SnapshotRunInput,
} from '@lar-factory/shared/run-settings';

import { WorkRecordError, type Database } from './database.ts';
import { readFactorySettings } from './factory-settings.ts';
import { captureRunSettings, executionSettings, invalidRun, runObject, runText } from './run-settings-input.ts';
import type { WorkRecord } from './work-records.ts';

export interface RunSettingsRecords {
    snapshotRun(workId: string, revision: number, input: SnapshotRunInput): RunSettings;
    runSettings(workId: string, runId?: string): { workId: string; runs: RunSettings[]; roleRuns: RoleRun[] };
    startRoleRun(workId: string, revision: number, input: RoleRunInput): RoleRun;
    finishRoleRun(workId: string, revision: number, input: RoleRunFinish): RoleRun;
}

/** Used inside the caller's read/write transaction; a run ID never resolves across work records. */
export function savedRun(database: Database, workId: string, runId: string): RunSettings {
    const row = database.db
        .prepare('SELECT content FROM run_settings WHERE work_id=? AND run_id=?')
        .get(workId, runText(runId));

    if (!row) throw new WorkRecordError('not-found', `No run ${runId} belongs to ${workId}.`);

    return JSON.parse(String(row.content)) as RunSettings;
}

/** Local evidence only. No provider calls, tracker sync, repository configuration or launch side effects. */
export function runSettingsRecords(
    database: Database,
    read: (id: string) => WorkRecord,
    dir: string,
): RunSettingsRecords {
    const { db } = database;
    const bump = (workId: string) =>
        db
            .prepare('UPDATE work_records SET revision=revision+1, updated_at=? WHERE work_id=?')
            .run(new Date().toISOString(), workId);
    const expected = (workId: string, revision: number) => {
        const record = read(workId);

        if (!Number.isSafeInteger(revision) || revision < 1) invalidRun('Expected a positive work revision.');

        if (record.revision !== revision)
            throw new WorkRecordError(
                'stale-revision',
                `The work record ${workId} is at revision ${record.revision}, not ${revision}.`,
            );
    };
    const execution = (workId: string, executionId: string): RoleRun | null => {
        const row = db
            .prepare('SELECT content FROM role_runs WHERE work_id=? AND execution_id=?')
            .get(workId, executionId);

        return row ? (JSON.parse(String(row.content)) as RoleRun) : null;
    };

    return {
        snapshotRun: (workId, revision, input) =>
            database.write(() => {
                expected(workId, revision);

                const runId = runText(input?.runId);
                const existing = db
                    .prepare('SELECT 1 FROM run_settings WHERE work_id=? AND run_id=?')
                    .get(workId, runId);

                if (existing) {
                    const snapshot = savedRun(database, workId, runId);

                    if (snapshot.kind !== input.kind) invalidRun('A run ID cannot change kind.');

                    return snapshot;
                }

                const { settings, problem } = readFactorySettings(dir);

                // The caller must surface recovery instead of silently freezing a policy from a backup.
                if (problem) invalidRun(problem);

                const snapshot = captureRunSettings(workId, input, settings);

                db.prepare('INSERT INTO run_settings(work_id,run_id,content) VALUES (?,?,?)').run(
                    workId,
                    runId,
                    JSON.stringify(snapshot),
                );
                bump(workId);

                return snapshot;
            }),
        runSettings: (workId, runId) =>
            database.read(() => {
                read(workId);

                const runs =
                    runId === undefined
                        ? db
                              .prepare('SELECT content FROM run_settings WHERE work_id=? ORDER BY rowid')
                              .all(workId)
                              .map((row) => JSON.parse(String(row.content)) as RunSettings)
                        : [savedRun(database, workId, runId)];
                const roleRuns = db
                    .prepare('SELECT content FROM role_runs WHERE work_id=? ORDER BY rowid')
                    .all(workId)
                    .map((row) => JSON.parse(String(row.content)) as RoleRun)
                    .filter((run) => runId === undefined || run.runId === runId);

                return { workId, runs, roleRuns };
            }),
        startRoleRun: (workId, revision, input) =>
            database.write(() => {
                expected(workId, revision);
                runObject(input, ['runId', 'executionId', 'role', 'threadId', 'taskId', 'launchOptions']);

                const executionId = runText(input.executionId);
                const snapshot = savedRun(database, workId, input.runId);
                const role = runText(input.role) as RoleRunInput['role'];
                const requested =
                    role === 'thread'
                        ? snapshot.thread
                        : Object.hasOwn(snapshot.roles, role)
                          ? snapshot.roles[role]
                          : undefined;

                if (!requested) invalidRun(`Unknown run role: ${role}.`);

                const launchOptions =
                    input.launchOptions === undefined
                        ? undefined
                        : executionSettings({
                              model: requested!.model,
                              effort: requested!.effort,
                              options: input.launchOptions,
                          }).options;

                if (
                    launchOptions &&
                    (!requested!.model ||
                        executionMismatch(
                            requested!,
                            executionSettingsOf({
                                ...requested!.model!,
                                options: launchOptions,
                            }),
                        ))
                )
                    invalidRun('Launch options must match the frozen requested settings.');

                const identity = {
                    workId,
                    runId: snapshot.runId,
                    executionId,
                    role,
                    ...(input.threadId === undefined ? {} : { threadId: runText(input.threadId) }),
                    ...(input.taskId === undefined ? {} : { taskId: runText(input.taskId) }),
                    ...(launchOptions === undefined ? {} : { launchOptions }),
                };
                const old = execution(workId, executionId);

                if (old) {
                    if (
                        Object.entries(identity).some(
                            ([key, value]) => JSON.stringify(old[key as keyof RoleRun]) !== JSON.stringify(value),
                        ) ||
                        old.threadId !== identity.threadId ||
                        old.taskId !== identity.taskId ||
                        JSON.stringify(old.launchOptions) !== JSON.stringify(identity.launchOptions)
                    )
                        invalidRun('An execution ID cannot be reused for another attempt.');

                    return old;
                }

                const run: RoleRun = {
                    ...identity,
                    requested: requested!,
                    actual: null,
                    report: null,
                    startedAt: new Date().toISOString(),
                    endedAt: null,
                    result: 'running',
                    failure: null,
                };

                db.prepare('INSERT INTO role_runs(work_id,run_id,execution_id,content) VALUES (?,?,?,?)').run(
                    workId,
                    snapshot.runId,
                    executionId,
                    JSON.stringify(run),
                );
                bump(workId);

                return run;
            }),
        finishRoleRun: (workId, revision, input) =>
            database.write(() => {
                expected(workId, revision);
                runObject(input, ['executionId', 'report', 'result', 'failure']);

                const old = execution(workId, runText(input.executionId));

                if (!old) throw new WorkRecordError('not-found', 'No such role execution belongs to this work record.');

                if (!['completed', 'failed'].includes(input.result)) invalidRun('Invalid role result.');

                let report: RoleRunFinish['report'] = null;

                if (input.report !== null) {
                    const supplied = runObject(input.report, ['source', 'reference', 'actual']);

                    if (supplied.source !== 't3') invalidRun('Actual settings must come from a T3 report.');

                    report = {
                        source: 't3',
                        reference: runText(supplied.reference),
                        actual: executionSettings(supplied.actual),
                    };
                }

                const failure = input.result === 'failed' ? runText(input.failure) : null;

                if (input.result === 'completed' && input.failure !== undefined)
                    invalidRun('A completed role cannot carry a failure.');

                if (old.endedAt !== null) {
                    if (
                        JSON.stringify(old.report) !== JSON.stringify(report) ||
                        old.result !== input.result ||
                        old.failure !== failure
                    )
                        invalidRun('A completed role execution is immutable; record a new attempt.');

                    return old;
                }

                const run: RoleRun = {
                    ...old,
                    report,
                    actual: report?.actual ?? null,
                    result: input.result,
                    failure,
                    endedAt: new Date().toISOString(),
                };

                db.prepare('UPDATE role_runs SET content=? WHERE work_id=? AND execution_id=?').run(
                    JSON.stringify(run),
                    workId,
                    old.executionId,
                );
                bump(workId);

                return run;
            }),
    };
}
