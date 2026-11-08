// The start an item shows, combining this page's press with the server's progress and recorded thread.
// Pending, uncertain and completed starts hold the actions that would move the item away.

import { startProgressOf } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';

import { PURPOSE, useStart } from './StartStore';
import type { StartKind } from './StartStore';

/**
 * The T3 thread Start opened for the item, from this page, another one or the board server's Start after. The
 * board data keeps refining threads and build threads apart, so a refined item's shaping thread is no build.
 */
export function startedThread(item: Item, data: BoardData, kind: StartKind) {
    return (kind === 'refine' ? data.started : data.startedBuilds)?.[item.id];
}

/** The item's start as the row shows it: this page's press at once, then what the server says. */
export function useShownStart(item: Item, data: BoardData, kind: StartKind) {
    const local = useStart(item.id, kind);
    const server = startProgressOf(data, item.id, PURPOSE[kind]);

    return {
        pending: local?.phase === 'pending' || server?.phase === 'starting',
        uncertain: server?.phase === 'may-have-started',
        error: server?.phase === 'failed' ? server.message : local?.phase === 'error' ? local.message : undefined,
    };
}

/** Whether Start is in flight, uncertain or done, which takes Move to List and Abandon away. */
export function useStartHolds(item: Item, data: BoardData): boolean {
    const { pending, uncertain } = useShownStart(item, data, 'refine');

    return Boolean(startedThread(item, data, 'refine')) || uncertain || pending;
}
