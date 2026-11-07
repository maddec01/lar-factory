// A fully written owner file is linked atomically beside the database. Live owners never expire by timeout.
import { realpath } from 'node:fs/promises';

import { acquireOwnerLock, type OwnerLease } from './owner-file.ts';

export type TrackerSyncLease = OwnerLease;
export class TrackerSyncLockLost extends Error {}

/** Busy callers return immediately. A dead owner's generation gets its own atomic recovery guard. */
export async function acquireTrackerSyncLock(database: string): Promise<TrackerSyncLease | null> {
    return acquireOwnerLock(
        `${await realpath(database)}.structure-sync.lock`,
        () => new TrackerSyncLockLost('Another process owns this structural save now.'),
    );
}
