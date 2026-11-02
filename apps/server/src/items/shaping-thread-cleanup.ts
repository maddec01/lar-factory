// Shaping thread cleanup on the board: this Mac's setting for what happens to an item's shaping threads after Start
// build, as Settings shows and saves it.

import type { ShapingThreadCleanup, ShapingThreadCleanupState } from '@lar-factory/shared';
import { readShapingThreadCleanup, writeShapingThreadCleanup, WorkRecordError, type WorkRecords } from '@lar-factory/work-records';
import type { Reply } from './item-commands.ts';

export interface BoardShapingThreadCleanup {
  /** The choice as Settings shows it, or why it can't be read. */
  state(): ShapingThreadCleanupState;
  /** Saves Settings' `choice`, which also replaces a file the board can't read. */
  save(input: Record<string, unknown>): Reply;
}

export interface ShapingThreadCleanupDeps {
  /** The work records whose threads the setting cleans up; null in sample mode and when they couldn't be opened. */
  records: WorkRecords | null;
  /** The board's data folder, where the setting lives; tests give their own. */
  dir?: string;
  /** Shows the board as it is after a saved change. */
  changed?: () => void;
}

export function createShapingThreadCleanup({ records, dir, changed = () => {} }: ShapingThreadCleanupDeps): BoardShapingThreadCleanup {
  return {
    state() {
      try { return { choice: readShapingThreadCleanup(dir) }; }
      catch (err) { return { problem: (err as Error).message }; }
    },
    save({ choice }) {
      if (!records) return { status: 409, body: { error: 'The board has no work records whose threads it could clean up.' } };
      try {
        writeShapingThreadCleanup(choice as ShapingThreadCleanup, dir);
      } catch (err) {
        if (!(err instanceof WorkRecordError)) throw err;
        return { status: err.code === 'invalid' ? 400 : 500, body: { error: err.message } };
      }
      changed();
      return { status: 200, body: { error: null } };
    },
  };
}
