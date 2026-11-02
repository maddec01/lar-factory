// Shaping thread cleanup on the board: this Mac's setting for what happens to an item's shaping threads after Start
// build, as Settings shows and saves it, and the sweep that does it.

import type { ShapingThreadCleanup, ShapingThreadCleanupState } from '@lar-factory/shared';
import { readShapingThreadCleanup, writeShapingThreadCleanup, WorkRecordError, type WorkRecords } from '@lar-factory/work-records';
import type { ThreadCleanupState } from '../t3/item-execution.ts';
import type { lookupThread } from '../t3/t3.ts';
import type { ThreadCommand, ThreadCommandResult } from '../t3/thread-commands.ts';
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

export interface ShapingThreadSweepDeps {
  records: WorkRecords;
  /** One thread's state in T3's current snapshot. */
  stateOf(threadId: string): ThreadCleanupState;
  /** Confirms a deletion, which a thread's absence from a snapshot doesn't prove. */
  lookup: typeof lookupThread;
  /** Issues a T3 session, so it runs only for a command the sweep will send. */
  send(command: ThreadCommand): Promise<ThreadCommandResult>;
  now?: () => number;
}

/** How long a thread waits after a failure or an unconfirmed answer before the sweep tries it again. */
const RETRY_MS = 30_000;

/** A function that takes each pending shaping thread one step on, one sweep at a time. It never interrupts a live thread. */
export function createShapingThreadSweep({ records, stateOf, lookup, send, now = Date.now }: ShapingThreadSweepDeps): () => Promise<void> {
  const retryAt = new Map<string, number>();
  let sweeping = false;
  const later = (threadId: string) => retryAt.set(threadId, now() + RETRY_MS);
  const cleaned = (threadId: string) => {
    retryAt.delete(threadId);
    records.markShapingThreadCleaned(threadId);
  };
  async function step({ threadId, commandId }: { threadId: string; commandId: string }): Promise<void> {
    // Read just before sending: T3 refuses to archive an archived thread, and its deletion cancels active runs.
    const state = stateOf(threadId);
    if (state === 'unavailable') return;
    if (state === 'absent') {
      if (await lookup(threadId) === 'deleted') cleaned(threadId);
      else later(threadId);
      return;
    }
    if (state.live) return;
    if (state.archived) return cleaned(threadId);
    const result = await send({ type: 'thread.archive', commandId, threadId });
    if (result.outcome === 'accepted') return cleaned(threadId);
    later(threadId);
    if (result.outcome === 'rejected') records.saveShapingThreadRejection(threadId, result.reason);
    else records.saveShapingThreadFailure(threadId, result.reason);
  }
  return async () => {
    if (sweeping) return;
    sweeping = true;
    try {
      for (const row of records.pendingShapingThreadCleanups()) {
        // Settle and delete come next, and a row with no action waits for the notice about an unreadable setting.
        if (row.action !== 'archive' || now() < (retryAt.get(row.threadId) ?? -Infinity)) continue;
        try { await step(row); }
        catch (err) {
          later(row.threadId);
          records.saveShapingThreadFailure(row.threadId, (err as Error).message);
        }
      }
    } finally { sweeping = false; }
  };
}
