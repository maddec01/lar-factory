import { randomUUID } from 'node:crypto';

import { WorkRecordError, type Database } from './database.ts';
import type { WorkRecord } from './work-records.ts';

export interface CheckEntry {
    command: string[];
    folder: string;
}
export interface CheckStart extends CheckEntry {
    role: string;
    tree: string | null;
    reason?: string;
    live?: boolean;
}
export interface CheckFinish {
    tree: string | null;
    exitStatus: number | null;
    interrupted: boolean;
    log: string | null;
}
export interface CheckRun extends CheckEntry {
    checkId: string;
    workId: string;
    role: string;
    tree: string | null;
    endTree: string | null;
    /** startedAt is null while the run waits for a heavy command slot, and tree stays null until then too. */
    reason: string | null;
    live: boolean;
    startedAt: string | null;
    endedAt: string | null;
    exitStatus: number | null;
    interrupted: boolean;
    log: string | null;
    failure: { tests: string[]; diagnosis: string } | null;
    resolution: string | null;
}
export interface CheckReuse {
    checkId: string;
    role: string;
    reason: string;
    tree: string;
    recordedAt: string;
}
/** The caller supplies snapshots and process outcomes. Missing logs do not invalidate an otherwise stable pass.
 * Commands are argv arrays, including empty arguments; folders use normalized repository-relative paths.
 * Reuse always names the caller's target tree. Live passes are read directly and cannot create reuse rows.
 */
export interface ValidationRecords {
    startCheck(workId: string, input: CheckStart): CheckRun;
    /** Records a run waiting for a heavy command slot, with no tree or start time until beginCheck. */
    waitCheck(workId: string, input: Omit<CheckStart, 'tree'>): CheckRun;
    beginCheck(checkId: string, input: { tree: string | null }): CheckRun;
    finishCheck(checkId: string, input: CheckFinish): CheckRun;
    setCheckList(workId: string, entries: CheckEntry[]): CheckEntry[];
    checks(
        workId: string,
        now?: Date,
    ): {
        workId: string;
        list: CheckEntry[];
        runs: (CheckRun & {
            outcome: 'unfinished' | 'interrupted' | 'failed' | 'expired' | 'passed';
            snapshotState: 'unfinished' | 'missing' | 'changed' | 'stable';
            eligible: boolean;
            failureState: 'open' | 'resolved' | null;
        })[];
        reuses: CheckReuse[];
    };
    reuseCheck(workId: string, checkId: string, input: { role: string; reason: string; tree: string }): CheckReuse;
    describeFailure(checkId: string, input: { tests: string[]; diagnosis: string }): CheckRun;
    resolveFailure(checkId: string, reason: string): CheckRun;
}
const invalid = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};
const filled = (value: unknown): string =>
    typeof value === 'string' && value.trim() && !value.includes('\0')
        ? value
        : invalid('Expected nonempty text without NUL.');
const tree = (value: unknown): string | null =>
    value === null
        ? null
        : typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)
          ? value
          : invalid('Expected a git tree object ID or null.');
function entry(value: CheckEntry): CheckEntry {
    if (
        !Array.isArray(value?.command) ||
        !value.command.length ||
        value.command.some((arg) => typeof arg !== 'string' || arg.includes('\0'))
    )
        invalid('A command must be a nonempty argument array without NUL.');
    filled(value.command[0]);
    const folder = filled(value.folder);
    if (
        folder !== '.' &&
        (folder.startsWith('/') ||
            folder.includes('\\') ||
            folder.split('/').some((part) => !part || part === '.' || part === '..'))
    )
        invalid('The folder must be a normalized repository-relative path.');
    return { command: [...value.command], folder };
}
const passed = (run: CheckRun): boolean => run.endedAt !== null && !run.interrupted && run.exitStatus === 0;
const failed = (run: CheckRun): boolean =>
    run.endedAt !== null && !run.interrupted && run.exitStatus !== null && run.exitStatus !== 0;
const eligible = (run: CheckRun): boolean => passed(run) && run.tree !== null && run.tree === run.endTree;

export function validationRecords(database: Database, read: (id: string) => WorkRecord): ValidationRecords {
    const { db } = database;
    const owner = (id: string): string => {
        let record = read(id);
        if (record.kind === 'slice') {
            if (!record.parentId) invalid('The slice has no build.');
            record = read(record.parentId!);
        }
        if (!['build', 'bug', 'feature', 'improvement', 'issue'].includes(record.kind))
            invalid('Validation records require buildable work.');
        return record.workId;
    };
    const get = (id: string): CheckRun => {
        const row = db.prepare('SELECT content FROM check_runs WHERE check_id=?').get(id);
        if (!row) throw new WorkRecordError('not-found', `Check ${id} does not exist.`);
        return JSON.parse(String(row.content)) as CheckRun;
    };
    const save = (run: CheckRun): CheckRun => {
        db.prepare('UPDATE check_runs SET content=? WHERE check_id=?').run(JSON.stringify(run), run.checkId);
        return run;
    };
    const insert = (
        id: string,
        input: Omit<CheckStart, 'tree'>,
        start: { tree: string | null; startedAt: string | null },
    ): CheckRun =>
        database.write(() => {
            const run: CheckRun = {
                ...entry(input),
                workId: owner(id),
                checkId: randomUUID(),
                role: filled(input.role),
                ...start,
                endTree: null,
                reason: input.reason === undefined ? null : filled(input.reason),
                live: input.live ?? false,
                endedAt: null,
                exitStatus: null,
                interrupted: false,
                log: null,
                failure: null,
                resolution: null,
            };
            if (typeof run.live !== 'boolean') invalid('live must be boolean.');
            db.prepare('INSERT INTO check_runs(check_id,work_id,content) VALUES (?,?,?)').run(
                run.checkId,
                run.workId,
                JSON.stringify(run),
            );
            return run;
        });
    return {
        startCheck: (id, input) => insert(id, input, { tree: tree(input.tree), startedAt: new Date().toISOString() }),
        waitCheck: (id, input) => insert(id, input, { tree: null, startedAt: null }),
        beginCheck: (id, input) =>
            database.write(() => {
                const run = get(id);
                if (run.startedAt || run.endedAt) invalid('The check has already started.');
                return save({ ...run, tree: tree(input.tree), startedAt: new Date().toISOString() });
            }),
        finishCheck: (id, input) =>
            database.write(() => {
                const run = get(id);
                if (run.endedAt) invalid('The check is already finished.');
                if (
                    typeof input.interrupted !== 'boolean' ||
                    !(
                        (input.exitStatus === null && input.interrupted) ||
                        (Number.isSafeInteger(input.exitStatus) && input.exitStatus! >= 0 && input.exitStatus! <= 255)
                    )
                )
                    invalid('Expected an exit status from 0 to 255, or null for interruption.');
                const log = input.log === null ? null : filled(input.log);
                if (log !== null && log !== `check-logs/${run.workId}/${id}.log`)
                    invalid('The log reference must name this check in check-logs.');
                return save({
                    ...run,
                    endTree: tree(input.tree),
                    endedAt: new Date().toISOString(),
                    exitStatus: input.exitStatus,
                    interrupted: input.interrupted,
                    log,
                });
            }),
        setCheckList: (id, entries) =>
            database.write(() => {
                const workId = owner(id);
                if (!Array.isArray(entries)) invalid('The check list must be an array.');
                const list = entries.map(entry);
                if (new Set(list.map((item) => JSON.stringify(item))).size !== list.length)
                    invalid('The check list contains duplicates.');
                db.prepare(
                    'INSERT INTO check_lists(work_id,content) VALUES (?,?) ON CONFLICT(work_id) DO UPDATE SET content=excluded.content',
                ).run(workId, JSON.stringify(list));
                return list;
            }),
        checks: (id, now = new Date()) =>
            database.read(() => {
                if (!Number.isFinite(now.getTime())) invalid('Invalid time.');
                const workId = owner(id);
                const list = JSON.parse(
                    String(db.prepare('SELECT content FROM check_lists WHERE work_id=?').get(workId)?.content ?? '[]'),
                ) as CheckEntry[];
                const runs = db
                    .prepare('SELECT content FROM check_runs WHERE work_id=? ORDER BY rowid')
                    .all(workId)
                    .map((row) => {
                        const run = JSON.parse(String(row.content)) as CheckRun;
                        const expired =
                            run.live && run.endedAt !== null && now.getTime() - Date.parse(run.endedAt) >= 86400000;
                        const outcome: 'unfinished' | 'interrupted' | 'failed' | 'expired' | 'passed' = !run.endedAt
                            ? 'unfinished'
                            : run.interrupted
                              ? 'interrupted'
                              : failed(run)
                                ? 'failed'
                                : expired
                                  ? 'expired'
                                  : 'passed';
                        const snapshotState = !run.endedAt
                            ? ('unfinished' as const)
                            : !run.tree || !run.endTree
                              ? ('missing' as const)
                              : run.tree !== run.endTree
                                ? ('changed' as const)
                                : ('stable' as const);
                        return {
                            ...run,
                            outcome,
                            snapshotState,
                            eligible: eligible(run) && !expired,
                            failureState: failed(run)
                                ? run.resolution
                                    ? ('resolved' as const)
                                    : ('open' as const)
                                : null,
                        };
                    });
                const reuses = db
                    .prepare('SELECT content FROM check_reuses WHERE work_id=? ORDER BY rowid')
                    .all(workId)
                    .map((row) => JSON.parse(String(row.content)) as CheckReuse);
                return { workId, list, runs, reuses };
            }),
        reuseCheck: (id, checkId, input) =>
            database.write(() => {
                const workId = owner(id),
                    run = get(checkId);
                if (run.workId !== workId || !eligible(run) || run.live)
                    invalid('Reuse requires an eligible non-live pass belonging to this build.');
                const target = tree(input.tree);
                if (!target) invalid('Reuse requires a target tree.');
                const reuse: CheckReuse = {
                    checkId,
                    role: filled(input.role),
                    reason: filled(input.reason),
                    tree: target!,
                    recordedAt: new Date().toISOString(),
                };
                db.prepare('INSERT INTO check_reuses(work_id,check_id,content) VALUES (?,?,?)').run(
                    workId,
                    checkId,
                    JSON.stringify(reuse),
                );
                return reuse;
            }),
        describeFailure: (id, input) =>
            database.write(() => {
                const run = get(id);
                if (!failed(run)) invalid('Only a failed check can have a failure description.');
                if (!Array.isArray(input?.tests) || !input.tests.length) invalid('Name at least one failing test.');
                return save({
                    ...run,
                    failure: { tests: input.tests.map(filled), diagnosis: filled(input.diagnosis) },
                });
            }),
        resolveFailure: (id, reason) =>
            database.write(() => {
                const run = get(id);
                if (!failed(run)) invalid('Only a failed check can be resolved.');
                return save({ ...run, resolution: filled(reason) });
            }),
    };
}
