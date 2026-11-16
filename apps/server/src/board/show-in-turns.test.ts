import type { BoardData, Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { createBoardState } from './board-state.ts';
import { showInTurns } from './show-in-turns.ts';

const item = (id: string, status: Item['status']) =>
    ({ id, status, statuses: [status], state: 'open', number: 1, updatedAt: '2026-11-03T00:00:00Z' }) as Item;

/** A turn the test lets pass. */
function heldTurn() {
    let pass = () => {};
    const turn = () =>
        new Promise<void>((resolve) => {
            pass = resolve;
        });

    return { turn, pass: () => pass() };
}

const settle = () =>
    new Promise<void>((resolve) => {
        setImmediate(resolve);
    });

test('a read that reaches the board between the turns is read again in the showing turn', async () => {
    const board = createBoardState({ items: [item('a', 'Ready')] } as unknown as BoardData);
    let records = [item('a', 'Ready')];
    const { turn, pass } = heldTurn();
    const show = (items: Item[]) => board.applyRead(items, board.revision(), (read) => read);
    const shown = showInTurns(
        board,
        async () => records,
        () => records,
        show,
        turn,
    );

    await settle();
    // A command moves the work and shows the records at once, while the older read waits for its turn.
    records = [item('a', 'In progress')];
    show(records);
    pass();
    await shown;
    expect(board.find('a')?.status).toBe('In progress');
});
