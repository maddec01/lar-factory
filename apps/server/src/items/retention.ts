// Retention on the board: this Mac's setting for when finished and set-aside work leaves the board for Archive, and
// the timed delete Settings turns on. Nothing is deleted until the user confirms the work it would delete now, and
// each delete reports the due work it kept with the reason.

import type { RetentionState } from '@lar-factory/shared';
import { readRetention, writeRetention, WorkRecordError, type Retention, type WorkRecords } from '@lar-factory/work-records';
import { log } from '../log.ts';
import type { Reply } from './item-commands.ts';

export interface BoardRetention {
  /** The work IDs the setting hides now; none while the records or the setting can't be read. */
  hidden(): Set<string>;
  /** The setting as Settings shows it, with what the last timed delete did. */
  state(): RetentionState;
  /**
   * Saves Settings' `hideAfterDays` and `deleteAfterDays`. A new timed delete answers the work it would delete now,
   * with `due`, and saves only once `confirmed`; it then deletes that work at once.
   */
  save(input: Record<string, unknown>): Reply;
  /** Deletes the work the timed delete has made due, once Settings turned it on. */
  deleteDue(): void;
}

export interface RetentionDeps {
  /** The work records the board shows; null in sample mode and when they couldn't be opened. */
  records: WorkRecords | null;
  /** The board's data folder, where the setting lives; tests give their own. */
  dir?: string;
  now?: () => Date;
  /** Shows the board as it is after a saved change. */
  changed?: () => void;
}

export function createRetention({ records, dir, now = () => new Date(), changed = () => {} }: RetentionDeps): BoardRetention {
  let lastDelete: RetentionState['lastDelete'];
  /** The setting, or why it can't be read. */
  const read = (): Retention | { problem: string } => {
    try { return readRetention(dir); }
    catch (err) { return { problem: (err as Error).message }; }
  };

  function deleteNow(retention: Retention): void {
    if (!records || retention.deleteAfterDays === null) return;
    const { deleted, kept } = records.deleteExpired(retention, now());
    if (deleted.length || kept.length) lastDelete = { at: now().toISOString(), deleted, kept };
  }

  return {
    hidden() {
      const retention = read();
      return records && !('problem' in retention) ? new Set(records.hidden(retention, now()).map((r) => r.workId)) : new Set();
    },
    state() {
      const retention = read();
      if ('problem' in retention) return { hideAfterDays: 0, deleteAfterDays: null, problem: retention.problem };
      return { ...retention, ...lastDelete && { lastDelete } };
    },
    save({ hideAfterDays, deleteAfterDays, confirmed }) {
      if (!records) return { status: 409, body: { error: 'The board has no work records to keep or delete.' } };
      const current = read();
      const next = { hideAfterDays, deleteAfterDays } as Retention;
      const newDelete = next.deleteAfterDays !== null && ('problem' in current || current.deleteAfterDays !== next.deleteAfterDays);
      try {
        if (newDelete && confirmed !== true) {
          // Validates the days the way the setting does, without saving it.
          const due = records.hidden({ hideAfterDays: next.deleteAfterDays as number, deleteAfterDays: null }, now());
          return { status: 200, body: { error: null, saved: false, due: due.map(({ workId, title }) => ({ workId, title })) } };
        }
        writeRetention(next, dir);
        deleteNow(next);
      } catch (err) {
        if (!(err instanceof WorkRecordError)) throw err;
        return { status: err.code === 'invalid' ? 400 : 500, body: { error: err.message } };
      }
      changed();
      return { status: 200, body: { error: null, saved: true } };
    },
    deleteDue() {
      const retention = read();
      if ('problem' in retention) return;
      try { deleteNow(retention); }
      catch (err) { log(`can't delete expired work records: ${(err as Error).message}`); }
    },
  };
}
