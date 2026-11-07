// Shows a read of the records in turns of the event loop: the read takes its own turns, then the threads and the publish
// take one, so a page sees the whole read or none of it.

import type { Item } from '@lar-factory/shared';

import { nextTurn } from '../startup/loop-trace.ts';
import type { BoardState } from './board-state.ts';

/**
 * Reads the items with `read`, gives the loop a turn, then shows them with `show`, which applies them in one step. A read
 * or change that reached the items during those turns may carry newer records. Then `readNow` reads them again in the
 * turn that shows them; with no `readNow`, the newer items stay and these are dropped, for the next refresh to correct.
 */
export async function showInTurns(
    board: Pick<BoardState, 'applied'>,
    read: () => Promise<Item[]>,
    readNow: (() => Item[]) | null,
    show: (items: Item[]) => void,
    turn: () => Promise<void> = nextTurn,
): Promise<void> {
    const applied = board.applied();
    const items = await read();

    await turn();

    if (board.applied() === applied) show(items);
    else if (readNow) show(readNow());
}
