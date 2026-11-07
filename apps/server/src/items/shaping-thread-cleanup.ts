// Shaping thread cleanup on the board: this Mac's setting for what happens to an item's shaping threads after Start
// build, as Settings shows and saves it, and the sweep that does it.

import type { ShapingThreadCleanup, ShapingThreadCleanupState } from '@lar-factory/shared';
import {
    readShapingThreadCleanup,
    writeShapingThreadCleanup,
    WorkRecordError,
    type ShapingThreadCleanupRow,
    type WorkRecords,
} from '@lar-factory/work-records';

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

export function createShapingThreadCleanup({
    records,
    dir,
    changed = () => {},
}: ShapingThreadCleanupDeps): BoardShapingThreadCleanup {
    return {
        state() {
            try {
                return { choice: readShapingThreadCleanup(dir) };
            } catch (err) {
                return { problem: (err as Error).message };
            }
        },
        save({ choice }) {
            if (!records)
                return {
                    status: 409,
                    body: { error: 'The board has no work records whose threads it could clean up.' },
                };
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

/** A row with no action, from a setting Start build couldn't read, gives this reason. */
const UNREADABLE_SETTING = "It can't read the shaping thread cleanup setting.";

/** What details says, by work ID, about work whose pending rows have a failure or no action. A thread only held back adds nothing. */
export function shapingThreadCleanupProblems(records: WorkRecords): Map<string, string> {
    const reasons = new Map<string, Set<string>>();
    for (const { workId, action, failure } of records.pendingShapingThreadCleanups()) {
        const reason = action ? failure : UNREADABLE_SETTING;
        if (reason)
            reasons.set(workId, (reasons.get(workId) ?? new Set()).add(/[.!?]$/.test(reason) ? reason : `${reason}.`));
    }
    return new Map(
        [...reasons].map(([workId, why]) => [
            workId,
            `The board couldn't clean up the shaping threads. ${[...why].join(' ')} It keeps trying.`,
        ]),
    );
}

export interface ShapingThreadSweepDeps {
    records: WorkRecords;
    /** The board's data folder, where the setting lives; tests give their own. */
    dir?: string;
    /** One thread's state in T3's current snapshot. */
    stateOf(threadId: string): ThreadCleanupState;
    /** Confirms a deletion, which a thread's absence from a snapshot doesn't prove. */
    lookup: typeof lookupThread;
    /** Issues a T3 session, so it runs only for a command the sweep will send. */
    send(command: ThreadCommand): Promise<ThreadCommandResult>;
    /** Told once a deletion is recorded, so the work's stats stop counting that thread. */
    deleted(workId: string): void;
    now?: () => number;
}

/** The choices that send T3 a command. */
type ThreadAction = Exclude<ShapingThreadCleanup, 'keep'>;

/** How long a thread waits after a failure or an unconfirmed answer before the sweep tries it again. */
const RETRY_MS = 30_000;
/** The longest a thread waits after a rejection. T3 keeps a receipt for each rejected command ID and never prunes them, so each rejection doubles the wait, starting from `RETRY_MS`. */
const MAX_REJECTED_RETRY_MS = 3_600_000;

/** A function that takes each pending shaping thread one step on, one sweep at a time. It never interrupts a live thread. */
export function createShapingThreadSweep({
    records,
    dir,
    stateOf,
    lookup,
    send,
    deleted,
    now = Date.now,
}: ShapingThreadSweepDeps): () => Promise<void> {
    const retryAt = new Map<string, number>();
    const rejectedRetryMs = new Map<string, number>();
    let sweeping = false;
    const later = (threadId: string, wait = RETRY_MS) => retryAt.set(threadId, now() + wait);
    /** The setting's first readable value becomes the row's action; until then the row waits, with its notice. */
    function savedSetting(threadId: string): ShapingThreadCleanup | null {
        let choice: ShapingThreadCleanup;
        try {
            choice = readShapingThreadCleanup(dir);
        } catch {
            return null;
        }
        records.saveShapingThreadAction(threadId, choice);
        return choice;
    }
    async function step({ threadId, workId, commandId }: ShapingThreadCleanupRow, action: ThreadAction): Promise<void> {
        const cleaned = () => {
            retryAt.delete(threadId);
            rejectedRetryMs.delete(threadId);
            if (action !== 'delete') return records.markShapingThreadCleaned(threadId);
            records.markShapingThreadDeleted(threadId);
            deleted(workId);
        };
        // Read just before sending: T3 refuses to archive an archived thread or settle one, and its deletion cancels active runs.
        const state = stateOf(threadId);
        if (state === 'unavailable') return;
        if (state === 'absent') {
            if ((await lookup(threadId)) === 'deleted') cleaned();
            else later(threadId);
            return;
        }
        if (state.live) return;
        if (action !== 'delete' && (state.archived || (action === 'settle' && state.settled))) return cleaned();
        const result = await send({ type: `thread.${action}`, commandId, threadId });
        if (result.outcome === 'accepted') return cleaned();
        if (result.outcome === 'rejected') {
            const wait = rejectedRetryMs.get(threadId) ?? RETRY_MS;
            rejectedRetryMs.set(threadId, Math.min(wait * 2, MAX_REJECTED_RETRY_MS));
            later(threadId, wait);
            records.saveShapingThreadRejection(threadId, result.reason);
        } else {
            later(threadId);
            records.saveShapingThreadFailure(threadId, result.reason);
        }
    }
    return async () => {
        if (sweeping) return;
        sweeping = true;
        try {
            for (const row of records.pendingShapingThreadCleanups()) {
                const action = row.action ?? savedSetting(row.threadId);
                // Keep's rows start cleaned.
                if (!action || action === 'keep' || now() < (retryAt.get(row.threadId) ?? -Infinity)) continue;
                try {
                    await step(row, action);
                } catch (err) {
                    later(row.threadId);
                    records.saveShapingThreadFailure(row.threadId, (err as Error).message);
                }
            }
        } finally {
            sweeping = false;
        }
    };
}
