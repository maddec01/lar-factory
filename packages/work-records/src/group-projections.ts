import type { ReconcileItem } from '@lar-factory/shared/group-reconciliation';
import { createHash } from 'node:crypto';

import { staleAnswerQuotes } from './answer-quotes.ts';
import { groupMembers } from './blocker-declarations.ts';
import { WorkRecordError, type Database } from './database.ts';
import { productContent } from './product-content.ts';
import { expectRevision } from './record-revision.ts';
import type { WorkRecords } from './work-records.ts';

type Sources = Record<string, string>;

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

function sources(records: WorkRecords, groupId: string, ownerId: string): Sources {
    return Object.fromEntries(
        groupMembers(records, groupId).map((r) => [
            r.workId,
            hash({
                title: r.title,
                kind: r.kind,
                setAside: r.setAside,
                supersededBy: r.supersededBy,
                brief: records.body(r.workId, 'brief'),
                blockers: records
                    .blockers(r.workId)
                    .map((b) => b.workId)
                    .sort(),
                answer:
                    r.kind === 'decision' && r.workId !== ownerId
                        ? productContent(
                              records.decisionAnswer(r.workId).current?.text ??
                                  records.decisionAnswer(r.workId).replacement?.text ??
                                  '',
                          )
                        : undefined,
            }),
        ]),
    );
}

/** Saved prose is a projection of these sources, not proof that its statements remain true forever. */
export function saveProjection(database: Database, records: WorkRecords, id: string, body: string): void {
    if (body !== 'answer' && body !== 'map') return;

    const r = records.read(id);
    const groupId = body === 'map' ? id : r.parentId;

    if (!groupId) return;

    database.db
        .prepare(
            'INSERT INTO group_projections(work_id,body,sources) VALUES (?,?,?) ON CONFLICT(work_id,body) DO UPDATE SET sources=excluded.sources',
        )
        .run(id, body, JSON.stringify(sources(records, groupId, id)));
}

export function projectionChecks(records: WorkRecords, groupId: string): Omit<ReconcileItem, 'digest'>[] {
    return records.groupProjectionChanges(groupId).map(({ workId, body, before, after }) => ({
        key: `projection:${body}:${workId}`,
        workId,
        kind: 'map',
        requiresFix: true,
        changes: Object.keys(after).filter((id) => before[id] !== after[id]),
        before,
        after,
        summary: `Review current ${body} against changed answers, briefs and group stage; refresh-projections preserves history.`,
    }));
}

export function groupProjectionRecords(database: Database, get: () => WorkRecords) {
    return {
        mapHistory: (id: string) =>
            database.read(() =>
                database.db
                    .prepare(`SELECT written,markdown,recorded_at FROM map_history WHERE work_id=?
                     UNION ALL SELECT b.written,b.markdown,r.updated_at AS recorded_at
                     FROM bodies b JOIN work_records r USING(work_id) WHERE b.work_id=? AND b.body='map'
                     ORDER BY written`)
                    .all(id, id)
                    .map((row) => ({
                        written: Number(row.written),
                        text: String(row.markdown),
                        recordedAt: String(row.recorded_at),
                    })),
            ),
        groupProjectionChanges: (groupId: string) =>
            database.read(() => {
                const records = get();
                const changes: { workId: string; body: string; before: Sources; after: Sources }[] = [];

                for (const r of groupMembers(records, groupId).filter((r) => !r.setAside)) {
                    const body =
                        r.workId === groupId
                            ? 'map'
                            : r.kind === 'decision' && records.decisionAnswer(r.workId).current
                              ? 'answer'
                              : null;

                    if (!body || !records.body(r.workId, body)) continue;

                    const row = database.db
                        .prepare('SELECT sources FROM group_projections WHERE work_id=? AND body=?')
                        .get(r.workId, body);
                    // Older databases acquire source checkpoints on the first explicit projection refresh.
                    const before: Sources = row ? JSON.parse(String(row.sources)) : {};
                    const after = sources(records, groupId, r.workId);

                    if (hash(before) !== hash(after)) changes.push({ workId: r.workId, body, before, after });
                }

                return changes;
            }),
        refreshProjections: (
            groupId: string,
            revisions: Record<string, number>,
            input: { map?: string; answers: Record<string, string> },
        ) =>
            database.write(() => {
                const records = get();
                const members = groupMembers(records, groupId);

                for (const r of members) expectRevision(r, revisions?.[r.workId] as number);

                if (!input || typeof input.answers !== 'object' || !input.answers || Array.isArray(input.answers))
                    throw new WorkRecordError('invalid', 'Supply current answers and optional map.');

                if (staleAnswerQuotes(records, groupId, input.answers).length)
                    throw new WorkRecordError(
                        'invalid',
                        'Answer quote no longer appears in the current brief; repair current answers before refreshing projections.',
                    );

                for (const [id, answer] of Object.entries(input.answers)) {
                    if (
                        !members.some(
                            (r) =>
                                r.workId === id &&
                                r.kind === 'decision' &&
                                !r.setAside &&
                                records.decisionAnswer(id).current,
                        )
                    )
                        throw new WorkRecordError('invalid', 'Refresh only current answers in this group.');

                    if (typeof answer !== 'string' || !answer.trim())
                        throw new WorkRecordError('invalid', 'Supply a nonempty current answer.');

                    records.setBody(id, records.read(id).revision, 'answer', answer);
                }

                if (input.map !== undefined) records.setBody(groupId, records.read(groupId).revision, 'map', input.map);

                for (const id of Object.keys(input.answers)) saveProjection(database, records, id, 'answer');

                if (input.map !== undefined) saveProjection(database, records, groupId, 'map');

                return records.groupProjectionChanges(groupId);
            }),
    };
}
