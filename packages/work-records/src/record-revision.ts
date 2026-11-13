import { WorkRecordError } from './database.ts';
import type { WorkRecord } from './work-records.ts';

export function expectRevision(record: WorkRecord, revision: number): void {
    if (!Number.isSafeInteger(revision) || revision < 1)
        throw new WorkRecordError('invalid', 'The revision must be a whole number from 1.');

    if (record.revision !== revision)
        throw new WorkRecordError(
            'stale-revision',
            `The work record ${record.workId} is at revision ${record.revision}, not ${revision}; read it again and retry.`,
        );
}
