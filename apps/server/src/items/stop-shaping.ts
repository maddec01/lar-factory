import { isRecord } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';
import { randomUUID } from 'node:crypto';

import type { BoardState } from '../board/board-state.ts';
import { readExecutionProjection } from '../t3/execution-capabilities.ts';
import { sendThreadCommand } from '../t3/thread-commands.ts';
import type { Reply } from './item-commands.ts';

interface Dependencies {
    board: BoardState;
    records: WorkRecords | null;
    reread: () => void;
    send?: typeof sendThreadCommand;
    projection?: typeof readExecutionProjection;
}

/** Stop belongs to the recorded owner; it never abandons work or deletes its history. */
export function createShapingControl({
    board,
    records,
    reread,
    send = sendThreadCommand,
    projection = readExecutionProjection,
}: Dependencies) {
    const pending = new Set<string>();

    return {
        async stopShaping(id: string): Promise<Reply> {
            if (pending.has(id)) return { status: 409, body: { error: 'Stop is pending.' } };

            pending.add(id);

            try {
                if (!records || !board.find(id)) throw new Error('This work is unavailable.');

                const record = records.read(id);

                if (!['Shaping', 'Needs you'].includes(record.status) || record.finishedAt || record.setAside)
                    throw new Error('Only active shaping can be stopped.');

                const owner = records
                    .threads(id)
                    .filter((thread) => thread.purpose === 'shape' && !thread.deletedAt)
                    .at(-1);

                if (!owner) throw new Error('No shaping owner is recorded.');

                const before = await projection(owner.threadId);

                if (!isRecord(before) || !Array.isArray(before.runs))
                    throw new Error('Shaping activity is unavailable. Try again.');

                const current = records
                    .threads(id)
                    .filter((thread) => thread.purpose === 'shape' && !thread.deletedAt)
                    .at(-1);

                if (current?.threadId !== owner.threadId)
                    throw new Error('The shaping owner changed. Re-read the item.');

                const active = before.runs
                    .filter(isRecord)
                    .filter((run) => ['running', 'queued'].includes(String(run.status)) && typeof run.id === 'string');

                if (!active.length)
                    throw new Error('No active shaping owner run is available to stop. Open the thread in T3.');

                const currentRecord = records.read(id);

                if (
                    !['Shaping', 'Needs you'].includes(currentRecord.status) ||
                    currentRecord.finishedAt ||
                    currentRecord.setAside
                )
                    throw new Error('Shaping ended while Stop was reading activity.');

                for (const run of active) {
                    const result = await send({
                        type: 'run.interrupt',
                        commandId: randomUUID(),
                        threadId: owner.threadId,
                        runId: String(run.id),
                    });

                    if (result.outcome !== 'accepted') throw new Error(`Stop not confirmed: ${result.reason}`);
                }
                reread();

                return { status: 200, body: { error: null, board: board.snapshot() } };
            } catch (error) {
                return { status: 409, body: { error: (error as Error).message, board: board.snapshot() } };
            } finally {
                pending.delete(id);
            }
        },
    };
}
