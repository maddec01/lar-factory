import { releaseApprovalStep, type OutcomeCheckRun } from '@lar-factory/shared';
import { createHash, randomUUID } from 'node:crypto';

import type { Database } from './database.ts';
import { WorkRecordError } from './database.ts';
import { gateOwner } from './gate-resume.ts';
import { resolveReleaseNotice } from './release-notice.ts';
import type { WorkRecords } from './work-records.ts';

/** Same durable dispatch contract as Outcome: one pair of T3 IDs per release input. */
export function releaseContinuationRecords(database: Database, get: () => WorkRecords) {
    const { db } = database;
    const inspect = (id: string) => {
        const records = get();
        const record = records.read(id);
        const plan = records.releasePlan(id);
        const parts = records.children(id).filter((part) => !part.setAside && part.kind !== 'slice');
        const next = plan?.steps.find((step) => !step.done);
        const ready =
            !!plan &&
            !record.setAside &&
            !record.finishedAt &&
            (!next || next.who.trim().toLowerCase() !== 'pedro') &&
            (record.needsYou === null || !!releaseApprovalStep(plan, record.needsYou)) &&
            !record.needsYouCauses.length &&
            parts.some((part) => part.kind === 'build') &&
            parts.every((part) => records.completion(part.workId).complete) &&
            (next !== undefined || (plan.steps.at(-1)?.done?.by === 'Pedro' && plan.outcomeCheck.result === 'pending'));
        const digest = createHash('sha256')
            .update(
                JSON.stringify({
                    plan,
                    parts: parts.map((part) => ({
                        id: part.workId,
                        pr: part.pullRequest,
                        finishedAt: part.finishedAt,
                    })),
                }),
            )
            .digest('hex');
        const row = db.prepare('SELECT content FROM release_continuations WHERE work_id=?').get(id);
        const saved = row ? (JSON.parse(String(row.content)) as OutcomeCheckRun) : null;

        return { ready, digest, run: saved?.digest === digest ? saved : null };
    };
    const save = (id: string, run: OutcomeCheckRun) =>
        db
            .prepare(
                'INSERT INTO release_continuations(work_id,content) VALUES(?,?) ON CONFLICT(work_id) DO UPDATE SET content=excluded.content',
            )
            .run(id, JSON.stringify(run));

    return {
        retryReleaseContinuation: (id: string, revision: number) =>
            database.write(() => {
                const record = get().read(id);
                const current = inspect(id);

                if (!Number.isSafeInteger(revision) || record.revision !== revision)
                    throw new WorkRecordError('stale-revision', 'The parent changed. Read its release again.');

                if (!current.ready) throw new WorkRecordError('invalid', 'This release is not ready to continue.');

                if (!current.run?.sent && !current.run?.rejected) return;

                db.prepare('DELETE FROM release_continuations WHERE work_id=?').run(id);
                db.prepare('UPDATE work_records SET revision=revision+1,updated_at=? WHERE work_id=?').run(
                    new Date().toISOString(),
                    id,
                );
            }),
        releaseContinuation: (id: string) => database.read(() => inspect(id)),
        prepareReleaseContinuation: (id: string) =>
            database.write(() => {
                resolveReleaseNotice(database, get().read(id));

                const current = inspect(id);

                if (!current.ready || current.run) return current;

                const records = get();
                const owner =
                    gateOwner(database, records.read(id)) ??
                    records
                        .children(id)
                        .filter((part) => part.kind === 'decision' && !part.setAside)
                        .map((part) => gateOwner(database, part))
                        .find(Boolean);

                if (!owner) return current;

                const run: OutcomeCheckRun = {
                    digest: current.digest,
                    ownerWorkId: owner.workId,
                    threadId: owner.threadId,
                    commandId: randomUUID(),
                    messageId: randomUUID(),
                    requestedAt: new Date().toISOString(),
                    sent: false,
                    error: null,
                };

                save(id, run);

                return { ...current, run };
            }),
        releaseContinuationDelivered: (
            id: string,
            commandId: string,
            result: 'accepted' | 'unconfirmed' | 'rejected',
            error?: string,
        ) =>
            database.write(() => {
                const { run } = inspect(id);

                if (!run || run.commandId !== commandId) return;

                save(id, {
                    ...run,
                    sent: result === 'accepted',
                    error: result === 'accepted' ? null : (error ?? 'Release continuation is unconfirmed.'),
                    rejected: result === 'rejected',
                });
            }),
    };
}
