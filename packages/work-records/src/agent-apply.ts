import { WorkRecordError, type WorkRecords } from './work-records.ts';

export interface AgentWriteIntent {
    id: string;
    revision: number;
    fields: readonly string[];
    entity?: 'work' | 'dependency';
}

/** Recheck every original intent on each attempt; the store still checks all revisions atomically. */
export function applyAgentWrite<T>(
    records: WorkRecords,
    intents: readonly AgentWriteIntent[],
    write: (revision: (id: string, entity?: 'work' | 'dependency') => number) => T,
): T {
    const revisions = () =>
        intents.map(({ id, revision, fields, entity }) => records.writeRevision(id, revision, fields, entity));

    for (let attempt = 0; attempt < 10; attempt++) {
        const latest = revisions();

        try {
            return write(
                (id, entity = 'work') =>
                    latest[intents.findIndex((intent) => intent.id === id && (intent.entity ?? 'work') === entity)]!,
            );
        } catch (error) {
            if (!(error instanceof WorkRecordError) || error.code !== 'stale-revision') throw error;

            // Exact answer versions and other store preconditions also use this error code.
            // Retry only when a record actually raced the supplied revisions.
            if (revisions().every((revision, index) => revision === latest[index])) throw error;
        }
    }
    throw new WorkRecordError(
        'stale-revision',
        'The records kept changing during reapplication. Reread the records and decide whether to reapply the write.',
    );
}
