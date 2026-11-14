import type { OutcomeCheckRun } from '@lar-factory/shared';
import { createHash, randomUUID } from 'node:crypto';

import type { Database } from './database.ts';
import { WorkRecordError } from './database.ts';
import { gateOwner } from './gate-resume.ts';
import { contractText } from './review-dependencies.ts';
import type { WorkRecords } from './work-records.ts';

/** One durable dispatch identity per delivered composition and release plan. */
export function outcomeRecords(database: Database, get: () => WorkRecords) {
    const { db } = database;
    const inspect = (id: string) => {
        const records = get();
        const record = records.read(id);
        const plan = records.releasePlan(id);
        const parts = records.children(id).filter((part) => part.kind !== 'slice' && !part.setAside);
        const ready =
            !!plan &&
            !record.setAside &&
            !record.finishedAt &&
            plan.outcomeCheck.result !== 'passed' &&
            parts.some((part) => part.kind === 'build') &&
            records.completion(id).reasons.every((reason) => reason.startsWith('Outcome check '));
        const digest = createHash('sha256')
            .update(
                JSON.stringify({
                    scope: records.confirmedScope(id)?.scope,
                    steps: plan?.steps,
                    what: plan?.outcomeCheck.what,
                    parts: parts
                        .map((part) => ({
                            id: part.workId,
                            pr: part.pullRequest,
                            finishedAt: part.finishedAt,
                            contract: contractText(records.body(part.workId, 'brief') ?? ''),
                            scope: records.confirmedScope(part.workId)?.scope,
                            answer: part.kind === 'decision' ? records.body(part.workId, 'answer')?.trim() : undefined,
                        }))
                        .sort((a, b) => a.id.localeCompare(b.id)),
                }),
            )
            .digest('hex');
        const row = db.prepare('SELECT content FROM outcome_runs WHERE work_id=?').get(id);
        const saved = row ? (JSON.parse(String(row.content)) as OutcomeCheckRun) : null;

        return { ready, digest, run: saved?.digest === digest ? saved : null };
    };
    const save = (id: string, run: OutcomeCheckRun) => {
        db.prepare(
            'INSERT INTO outcome_runs(work_id,content) VALUES(?,?) ON CONFLICT(work_id) DO UPDATE SET content=excluded.content',
        ).run(id, JSON.stringify(run));
    };

    return {
        outcomeCheck: (id: string) => database.read(() => inspect(id)),
        prepareOutcomeCheck: (id: string) =>
            database.write(() => {
                const current = inspect(id);

                if (!current.ready || current.run || get().releasePlan(id)?.outcomeCheck.result !== 'pending')
                    return current;

                const records = get();
                const record = records.read(id);
                const owner =
                    gateOwner(database, record) ??
                    records
                        .children(id)
                        .filter((part) => part.kind === 'decision' && !part.setAside)
                        .map((part) => gateOwner(database, part))
                        .find((owner) => !!owner);

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
        outcomeCheckDelivered: (
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
                    rejected: result === 'rejected',
                    error: result === 'accepted' ? null : (error ?? 'Outcome dispatch is unconfirmed.'),
                });
            }),
        validateOutcomeInput: (id: string, digest?: string) => {
            const current = inspect(id);

            if (digest !== undefined && (!current.ready || current.digest !== digest))
                throw new WorkRecordError(
                    'stale-revision',
                    'The delivered composition changed. Read the Outcome input again.',
                );

            if (current.run && digest === undefined)
                throw new WorkRecordError(
                    'invalid',
                    'Record the Outcome with --input-digest from its dispatched check.',
                );
        },
    };
}
