import type { ConceptBuildPlan, ConceptBuildRun } from '@lar-factory/shared';
import { createHash } from 'node:crypto';

import { WorkRecordError, type Database } from './database.ts';
import { workOrder } from './work-order.ts';
import type { WorkRecords } from './work-records.ts';

export interface ConceptRunRecords {
    reconcileConceptBuildRuns(): void;
    conceptBuildPlan(workId: string): ConceptBuildPlan;
    setConceptBuildRun(workId: string, revision: number, state: 'running' | 'paused'): ConceptBuildPlan;
}

interface SavedRun extends ConceptBuildRun {
    signature: string;
}

export function conceptRunRecords(database: Database, records: () => WorkRecords): ConceptRunRecords {
    const { db } = database;
    const inspect = (workId: string) => {
        const work = records();
        const group = work.read(workId);

        if (group.kind !== 'concept') throw new WorkRecordError('invalid', 'Only a concept has a concept build run.');

        const rows = workOrder(work, workId).filter((row) => !row.setAside);
        const holds: ConceptBuildPlan['holds'] = work
            .refinement(workId)
            .reasons.filter((reason) => !reason.startsWith('Its decision '))
            .map((reason) => ({ workId, reason }));

        if (group.setAside) holds.push({ workId, reason: 'The concept is set aside.' });

        if (group.needsYou) holds.push({ workId, reason: group.needsYou });

        if (!rows.some((row) => row.kind === 'build' && !row.complete))
            holds.push({ workId, reason: 'No remaining builds are planned.' });

        for (const row of rows) {
            const record = work.read(row.workId);

            if (row.kind !== 'build') {
                if (!row.complete)
                    holds.push({
                        workId: row.workId,
                        reason: `${row.title}: ${work.completion(row.workId).reasons.join(' ')}`,
                    });
            } else if (!row.complete) {
                if (!row.gate.passing)
                    holds.push({
                        workId: row.workId,
                        reason: `${row.title}: the current brief needs an approved gate.`,
                    });

                if (!['Ready', 'In progress', 'Review', 'Verify', 'Ready to merge'].includes(row.status))
                    holds.push({
                        workId: row.workId,
                        reason: `${row.title}: status is ${row.status}; finish shaping first.`,
                    });

                if (record.needsYou) holds.push({ workId: row.workId, reason: `${row.title}: ${record.needsYou}` });

                if (work.specState(row.workId).held)
                    holds.push({ workId: row.workId, reason: `${row.title}: resolve the changed ticket Spec.` });
            }
        }
        for (const id of [workId, ...rows.map((row) => row.workId)]) {
            for (const dependency of work.dependencies(id)) {
                if (!dependency.met && !dependency.replacedBy)
                    holds.push({ workId: id, reason: `Dependency on ${dependency.owner}: ${dependency.need}` });
            }
            for (const dependency of work.unmetDependencies(id))
                holds.push({ workId: id, reason: `Dependency on ${dependency.owner}: ${dependency.need}` });
        }

        const signature = createHash('sha256')
            .update(
                JSON.stringify({
                    map: work.body(workId, 'map'),
                    fog: group.fogGone,
                    setAside: group.setAside,
                    refinement: work.refinement(workId),
                    dependencies: [workId, ...rows.map((row) => row.workId)].flatMap((id) =>
                        work
                            .dependencies(id)
                            .map(({ dependencyId, need, owner, contract, evidence, blocks, met, replacedBy }) => ({
                                dependencyId,
                                need,
                                owner,
                                contract,
                                evidence,
                                blocks: [...blocks].sort(),
                                met: Boolean(met),
                                replacedBy,
                            })),
                    ),
                    members: rows
                        .map((row) => ({
                            id: row.workId,
                            kind: row.kind,
                            brief: row.brief,
                            ...(row.kind === 'decision' && {
                                decision: work.body(row.workId, 'decision'),
                                answer: work.body(row.workId, 'answer'),
                                drafts: work.body(row.workId, 'domain-drafts'),
                            }),
                            gate: row.gate.passing?.gateId,
                            blockers: row.blockers.map((blocker) => blocker.workId).sort(),
                        }))
                        .sort((a, b) => a.id.localeCompare(b.id)),
                }),
            )
            .digest('hex');

        return { rows, holds, signature, group };
    };
    const plan = (workId: string): ConceptBuildPlan => {
        const { rows, holds, signature } = inspect(workId);
        const row = db.prepare('SELECT content FROM concept_build_runs WHERE work_id=?').get(workId);
        const saved = row ? (JSON.parse(String(row.content)) as SavedRun) : null;
        const run: ConceptBuildRun | null = saved && {
            state: saved.state,
            startedAt: saved.startedAt,
            prepared: saved.prepared,
            ...(saved.pausedAt && { pausedAt: saved.pausedAt }),
            ...(saved.reason && { reason: saved.reason }),
        };

        if (run?.state === 'running' && saved!.signature !== signature) {
            run.state = 'paused';
            run.reason = 'Concept scope, gates or blockers changed. Check the holds and start concept builds again.';
        }

        return {
            run,
            holds,
            members: rows.map(({ workId, status, waits, complete }) => ({ workId, status, waits, complete })),
        };
    };

    return {
        reconcileConceptBuildRuns() {
            const changed = database.read(() =>
                db
                    .prepare(
                        `SELECT work_id FROM concept_build_runs WHERE json_extract(content, '$.state') = 'running'`,
                    )
                    .all()
                    .map((row) => String(row.work_id))
                    .filter((id) => plan(id).run?.state === 'paused'),
            );

            if (!changed.length) return;

            database.write(() => {
                for (const id of changed) {
                    const current = plan(id).run;

                    if (current?.state !== 'paused') continue;

                    const row = db.prepare('SELECT content FROM concept_build_runs WHERE work_id=?').get(id)!;
                    const saved = JSON.parse(String(row.content)) as SavedRun;

                    db.prepare('UPDATE concept_build_runs SET content=? WHERE work_id=?').run(
                        JSON.stringify({ ...saved, ...current, pausedAt: new Date().toISOString() }),
                        id,
                    );
                }
            });
        },
        conceptBuildPlan: (workId) => database.read(() => plan(workId)),
        setConceptBuildRun: (workId, revision, state) =>
            database.write(() => {
                if (state !== 'running' && state !== 'paused')
                    throw new WorkRecordError('invalid', 'Choose running or paused.');

                const { group, rows, holds, signature } = inspect(workId);

                if (group.revision !== revision)
                    throw new WorkRecordError('stale-revision', 'The concept changed; read its holds again.');

                if (state === 'running' && holds.length)
                    throw new WorkRecordError('invalid', holds.map((hold) => hold.reason).join('\n'));

                const now = new Date().toISOString();
                const previous = plan(workId).run;
                const saved: SavedRun = {
                    state,
                    startedAt: previous?.startedAt ?? now,
                    ...(state === 'paused' && { pausedAt: now }),
                    signature,
                    prepared:
                        state === 'paused' && previous
                            ? previous.prepared
                            : Object.fromEntries(
                                  [{ workId, revision }, ...rows].map((row) => [row.workId, row.revision]),
                              ),
                };

                db.prepare(
                    'INSERT INTO concept_build_runs(work_id,content) VALUES (?,?) ON CONFLICT(work_id) DO UPDATE SET content=excluded.content',
                ).run(workId, JSON.stringify(saved));
                db.prepare('UPDATE work_records SET revision=revision+1,updated_at=? WHERE work_id=?').run(now, workId);

                return plan(workId);
            }),
    };
}
