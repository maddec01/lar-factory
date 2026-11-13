import { pendingPedroReleaseStep } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

import type { BoardState } from '../board/board-state.ts';
import type { Reply } from './item-commands.ts';

/** Board-only receipt: the client supplies evidence, never the recording identity. */
export function createReleaseStep({
    board,
    records,
    reread,
}: {
    board: BoardState;
    records: WorkRecords | null;
    reread: () => void;
}) {
    return {
        async completeReleaseStep(id: string, input: Record<string, unknown>): Promise<Reply> {
            try {
                if (!records || !board.find(id)) throw new Error('This parent is unavailable on the board.');

                const record = records.read(id);
                const step = pendingPedroReleaseStep(records.releasePlan(id));

                if (record.setAside || record.finishedAt || !step || step.id !== input.stepId)
                    throw new Error('This release step is no longer waiting on Pedro.');

                if (!Number.isSafeInteger(input.revision) || record.revision !== input.revision)
                    throw new Error('The parent changed. Read its release steps again.');

                if (typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 1000)
                    throw new Error('Add short release evidence (up to 1000 characters).');

                records.completeReleaseStep(id, record.revision, step.id, 'Pedro', input.evidence);
                reread();

                return { status: 200, body: { error: null, board: board.snapshot() } };
            } catch (error) {
                return { status: 409, body: { error: (error as Error).message, board: board.snapshot() } };
            }
        },
    };
}
