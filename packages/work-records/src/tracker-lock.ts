// A fully written owner file is linked atomically beside the database. Live owners never expire by timeout.
import { randomUUID } from 'node:crypto';
import { realpath, unlink } from 'node:fs/promises';
import { claimPath, missing, ownerAt, processIdentity, releasePath, writeOwnerFile, type Owner } from './owner-file.ts';

export interface TrackerSyncLease { assertOwned(): Promise<void>; release(): Promise<void> }
export class TrackerSyncLockLost extends Error {}

/** Busy callers return immediately. A dead owner's generation gets its own atomic recovery guard. */
export async function acquireTrackerSyncLock(database: string): Promise<TrackerSyncLease | null> {
  const path = `${await realpath(database)}.structure-sync.lock`;
  const owner: Owner = { pid: process.pid, token: randomUUID(), identity: await processIdentity(process.pid) };
  const candidate = await writeOwnerFile(path, owner);
  try {
    if (!await claimPath(path, owner, path)) { await unlink(candidate); return null; }
  } catch (error) { try { await unlink(candidate); } catch { /* The acquisition error remains the useful diagnosis. */ } throw error; }
  let released = false;
  return {
    async assertOwned() {
      if (released || (await ownerAt(path))?.token !== owner.token) throw new TrackerSyncLockLost('Another process owns this structural save now.');
    },
    async release() {
      if (released) return;
      released = true;
      try { await releasePath(path, owner); } finally { try { await unlink(candidate); } catch (error) { if (!missing(error)) throw error; } }
    },
  };
}
