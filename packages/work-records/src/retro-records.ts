import { retroWaits, type Retro, type RetroSuggestion } from '@lar-factory/shared';
import { randomUUID } from 'node:crypto';

import { WorkRecordError, type Database } from './database.ts';
import { expectRevision } from './record-revision.ts';
import type { WorkRecord } from './work-records.ts';

export interface RetroRecords {
    retro(id: string): Retro | null;
    retroPending(id: string): boolean;
    prepareRetro(id: string): Retro | null;
    proposeRetro(id: string, revision: number, suggestions: RetroSuggestion[]): Retro;
    chooseRetro(id: string, revision: number, selected: number[], by: string): Retro;
    saveRetro(id: string, retro: Retro): void;
}

const invalid = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};
const text = (value: unknown, max: number): value is string =>
    typeof value === 'string' && !!value.trim() && value.length <= max && !value.includes('\0');

export function retroRecords(database: Database, read: (id: string) => WorkRecord): RetroRecords {
    const { db } = database;
    const get = (id: string): Retro | null => {
        read(id);

        const row = db.prepare('SELECT content FROM retros WHERE work_id=?').get(id);

        return row ? (JSON.parse(String(row.content)) as Retro) : null;
    };
    const save = (id: string, retro: Retro) => {
        db.prepare(
            'INSERT INTO retros(work_id,content) VALUES(?,?) ON CONFLICT(work_id) DO UPDATE SET content=excluded.content',
        ).run(id, JSON.stringify(retro));
        db.prepare('UPDATE work_records SET revision=revision+1,updated_at=? WHERE work_id=?').run(
            new Date().toISOString(),
            id,
        );
    };
    const merged = (id: string) => {
        const record = read(id);

        if (
            record.status !== 'Done' ||
            !record.finishedAt ||
            !record.pullRequest ||
            !db
                .prepare(
                    "SELECT 1 FROM observations WHERE work_id=? AND observed='pr' AND subject=? AND state='merged'",
                )
                .get(id, record.pullRequest)
        )
            invalid('Retro requires Done and a confirmed merge of the delivery PR.');

        return record;
    };

    return {
        retro: (id) => database.read(() => get(id)),
        retroPending: (id) =>
            database.read(() => {
                const retro = get(id);

                return retro
                    ? retro.suggestions === null || retroWaits(retro)
                    : read(id).status === 'Done' &&
                          read(id).buildPhase === 'checks' &&
                          !!db
                              .prepare(
                                  "SELECT 1 FROM threads WHERE work_id=? AND purpose='build' AND deleted_at IS NULL",
                              )
                              .get(id);
            }),
        prepareRetro: (id) =>
            database.write(() => {
                const record = merged(id);
                const prior = get(id);

                if (prior) return prior;

                if (record.buildPhase !== 'checks') return null;

                const thread = db
                    .prepare(
                        "SELECT thread_id FROM threads WHERE work_id=? AND purpose='build' AND deleted_at IS NULL ORDER BY rowid DESC LIMIT 1",
                    )
                    .get(id);

                if (!thread) return null;

                const retro: Retro = {
                    pr: record.pullRequest!,
                    suggestions: null,
                    choice: null,
                    captures: [],
                    delivery: {
                        threadId: String(thread.thread_id),
                        commandId: randomUUID(),
                        messageId: randomUUID(),
                        sent: false,
                        error: null,
                    },
                };

                save(id, retro);

                return retro;
            }),
        proposeRetro: (id, revision, suggestions) =>
            database.write(() => {
                expectRevision(merged(id), revision);

                const retro = get(id) ?? invalid('The board has not started this retro.');

                if (
                    !Array.isArray(suggestions) ||
                    suggestions.length > 100 ||
                    suggestions.some(
                        (s) =>
                            !s ||
                            !text(s.title, 500) ||
                            !text(s.description, 50000) ||
                            !text(s.repository, 500) ||
                            !['bug', 'feature', 'improvement'].includes(s.kind),
                    )
                )
                    invalid(
                        'Propose up to 100 follow-ups with title, description, repository and bug/feature/improvement kind.',
                    );

                if (retro.suggestions !== null) {
                    if (JSON.stringify(retro.suggestions) === JSON.stringify(suggestions)) return retro;

                    invalid('Retro suggestions are already recorded.');
                }

                db.prepare("UPDATE work_records SET build_phase='retro' WHERE work_id=?").run(id);
                retro.delivery.sent = true;
                retro.delivery.error = null;
                retro.suggestions = suggestions;
                retro.captures = suggestions.map(() => ({
                    requestId: randomUUID(),
                    ticketRequestId: randomUUID(),
                    workId: null,
                    error: null,
                    complete: false,
                }));
                save(id, retro);

                return retro;
            }),
        chooseRetro: (id, revision, selected, by) =>
            database.write(() => {
                expectRevision(merged(id), revision);

                const retro = get(id) ?? invalid('No retro is awaiting a choice.');

                if (!retro.suggestions?.length || retro.choice) invalid('No retro is awaiting a choice.');

                if (
                    !Array.isArray(selected) ||
                    new Set(selected).size !== selected.length ||
                    selected.some((n) => !Number.isSafeInteger(n) || n < 0 || n >= retro.suggestions!.length) ||
                    !text(by, 200)
                )
                    invalid('Choose only listed follow-ups, or No follow-ups.');

                retro.choice = { selected, by, at: new Date().toISOString() };
                save(id, retro);

                return retro;
            }),
        saveRetro: (id, retro) =>
            database.write(() => {
                merged(id);
                save(id, retro);
            }),
    };
}
