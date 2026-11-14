import type { ReconcileItem, ReconcileReport } from '@lar-factory/shared/group-reconciliation';
import { createHash } from 'node:crypto';

import { WorkRecordError, type Database } from './database.ts';
import { reconciliationChecks } from './reconciliation-checks.ts';
import type { WorkRecords } from './work-records.ts';

const hash = (value: unknown) =>
    createHash('sha256')
        .update(JSON.stringify(value) ?? 'undefined')
        .digest('hex');

type Snapshot = Record<
    string,
    { workId: string; title: string; kind: ReconcileItem['kind']; facts: Record<string, unknown> }
>;
type Done = ReconcileReport['completed'];

export interface ReconciliationRecords {
    /** Pure live projection: even a change made outside the owning thread becomes visible immediately. */
    reconciliation(groupId: string): ReconcileReport;
    reconcile(groupId: string): ReconcileReport;
    resolveReconcile(groupId: string, key: string, digest: string, evidence: string): ReconcileReport;
}

export function reconciliationRecords(database: Database, get: () => WorkRecords): ReconciliationRecords {
    const { db } = database;
    const saved = (id: string): { baseline: Snapshot; completed: Done; pending: ReconcileItem[] } => {
        const row = db
            .prepare('SELECT baseline, completed, pending FROM group_reconciliation WHERE work_id = ?')
            .get(id);

        return row
            ? {
                  baseline: JSON.parse(String(row.baseline)),
                  completed: JSON.parse(String(row.completed)),
                  pending: JSON.parse(String(row.pending)),
              }
            : { baseline: {}, completed: [], pending: [] };
    };
    const capture = (id: string): Snapshot => {
        const records = get(),
            group = records.read(id);

        if (group.parentId || group.kind === 'slice')
            throw new WorkRecordError('invalid', 'Reconcile the owning group or standalone work.');

        const snapshot: Snapshot = {};
        const visit = (workId: string) => {
            const r = records.read(workId);
            const gate = records.gate(workId);

            snapshot[`map:${workId}`] = {
                workId,
                title: r.title,
                kind: 'map',
                facts: {
                    title: r.title,
                    kind: r.kind,
                    parentId: r.parentId,
                    setAside: r.setAside,
                    supersededBy: r.supersededBy ?? null,
                    status: r.status,
                    queueOrder: r.queueOrder,
                    finishedAt: r.finishedAt,
                    blockers: records
                        .blockers(workId)
                        .map((b) => b.workId)
                        .sort(),
                    gate: gate.passing?.gateId ?? null,
                    brief: records.body(workId, 'brief'),
                    answer: r.kind === 'decision' ? records.decisionAnswer(workId) : null,
                    scope:
                        db
                            .prepare(
                                'SELECT content FROM confirmed_scopes WHERE work_id = ? ORDER BY revision DESC LIMIT 1',
                            )
                            .get(workId)?.content ?? null,
                    map: workId === id ? records.body(workId, 'map') : null,
                    ticket: records.specState(workId).base,
                    ticketHeld: records.specState(workId).held,
                    startingContext: records.initialContext(workId),
                },
            };
            for (const d of records.dependencies(workId))
                snapshot[`dependency:${d.dependencyId}`] = {
                    workId,
                    title: d.need,
                    kind: 'dependency',
                    facts: { ...d },
                };
            for (const child of records.children(workId)) if (child.kind !== 'slice') visit(child.workId);
        };

        visit(id);
        for (const [order, step] of records.releaseSteps(id).entries())
            snapshot[`release:${step.id}`] = {
                workId: id,
                title: step.title,
                kind: 'release',
                facts: { ...step, order },
            };

        const outcome = records.releasePlan(id)?.outcomeCheck;

        if (outcome)
            snapshot[`release-outcome:${id}`] = {
                workId: id,
                title: outcome.what,
                kind: 'release',
                facts: { ...outcome },
            };

        return Object.fromEntries(Object.entries(snapshot).sort(([a], [b]) => a.localeCompare(b)));
    };
    const report = (id: string): { report: ReconcileReport; snapshot: Snapshot } => {
        const state = saved(id),
            snapshot = capture(id);
        const items: ReconcileItem[] = [];

        for (const key of [...new Set([...Object.keys(snapshot), ...Object.keys(state.baseline)])].sort()) {
            const before = state.baseline[key],
                after = snapshot[key],
                source = after ?? before!;

            if (hash(before) === hash(after)) continue;

            const changes = !before
                ? ['added']
                : !after
                  ? ['removed']
                  : [...new Set([...Object.keys(before.facts), ...Object.keys(after.facts)])].filter(
                        (field) => hash(before.facts[field]) !== hash(after.facts[field]),
                    );
            const digest = hash([before ?? null, after ?? null]);

            if (!state.completed.some((done) => done.key === key && done.digest === digest))
                items.push({
                    key,
                    digest,
                    kind: source.kind,
                    workId: source.workId,
                    changes,
                    requiresFix: false,
                    before: before?.facts ?? null,
                    after: after?.facts ?? null,
                    summary: `${source.title}: reconcile ${source.kind === 'map' ? 'map and affected records' : source.kind} (${changes.join(', ')}).`,
                });
        }
        items.push(...reconciliationChecks(get(), id).map((item) => ({ ...item, digest: hash(item) })));
        items.sort((a, b) => a.key.localeCompare(b.key));

        return { snapshot, report: { groupId: id, digest: hash(items), items, completed: state.completed } };
    };
    const persist = (id: string, baseline: Snapshot, completed: Done, pending: ReconcileItem[]) =>
        db
            .prepare(
                'INSERT INTO group_reconciliation VALUES (?, ?, ?, ?) ON CONFLICT(work_id) DO UPDATE SET baseline = excluded.baseline, completed = excluded.completed, pending = excluded.pending',
            )
            .run(id, JSON.stringify(baseline), JSON.stringify(completed), JSON.stringify(pending));
    const finish = (id: string, current = report(id), state = saved(id)): ReconcileReport => {
        const cleared = state.pending.filter(
            (old) => old.requiresFix && !current.report.items.some((item) => item.key === old.key),
        );
        const completed = [
            ...state.completed,
            ...cleared.map(({ key, digest }) => ({
                key,
                digest,
                evidence: 'Recorded condition cleared; verified by reconcile.',
            })),
        ];

        persist(id, current.report.items.length ? state.baseline : current.snapshot, completed, current.report.items);

        return { ...current.report, completed };
    };

    return {
        reconciliation: (id) =>
            database.read(() => {
                // Join the caller's transaction, or pin all live board reads to one SQLite snapshot.
                if (db.isTransaction) return report(id).report;

                db.exec('BEGIN');

                try {
                    return report(id).report;
                } finally {
                    db.exec('ROLLBACK');
                }
            }),
        reconcile: (id) => database.write(() => finish(id)),
        resolveReconcile: (id, key, digest, evidence) =>
            database.write(() => {
                const current = report(id);
                const item = current.report.items.find((entry) => entry.key === key);

                if (!item || item.digest !== digest)
                    throw new WorkRecordError(
                        'stale-revision',
                        'The reconciliation item changed; run reconcile again.',
                    );

                if (item.requiresFix)
                    throw new WorkRecordError(
                        'invalid',
                        'Fix the recorded condition, then rerun reconcile; it cannot be checked off.',
                    );

                if (typeof evidence !== 'string' || !evidence.trim())
                    throw new WorkRecordError('invalid', 'Record how the affected records were reconciled.');

                const state = saved(id);

                const items = current.report.items.filter((entry) => entry.key !== key);

                return finish(
                    id,
                    { ...current, report: { ...current.report, items, digest: hash(items) } },
                    { ...state, completed: [...state.completed, { key, digest, evidence }] },
                );
            }),
    };
}
