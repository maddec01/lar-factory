import { reservesBuildSlot } from '@lar-factory/shared';

import type { WorkRecords } from './work-records.ts';

/** The durable reservation set used by both board projection and transactional claims. */
export function buildReservations(records: WorkRecords): string[] {
    const history = records.launchIntents({}).filter((intent) => intent.purpose === 'build');
    const attempted = new Set(history.map((intent) => intent.workId));
    const launches = new Set(history.filter((intent) => intent.outcome !== 'failed').map((intent) => intent.workId));

    return records
        .list({})
        .filter((row) => {
            const started =
                launches.has(row.workId) ||
                (!attempted.has(row.workId) && !!row.buildPhase) ||
                records.threads(row.workId).some((thread) => thread.purpose === 'build');

            return reservesBuildSlot({
                kind: row.kind,
                status: row.status,
                complete: !!row.finishedAt || records.completion(row.workId).complete,
                retired: row.setAside,
                coordinating: false,
                deliveryStarted: started,
                pullRequest: !!row.pullRequest,
            });
        })
        .map((row) => row.workId);
}
