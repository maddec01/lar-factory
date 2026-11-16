import type { BoardData } from '@lar-factory/shared';
import { WorkRecordError } from '@lar-factory/work-records';
import { expect, test, vi } from 'vite-plus/test';

import { createBoardState } from './board-state.ts';
import { createLocalWork } from './local-work.ts';

const fixture = () => {
    const board = createBoardState({ items: [] } as unknown as BoardData);
    const log = vi.fn();

    return { board, log, local: createLocalWork(board, log) };
};

test('a newer schema blocks all recovery until restart, with one sanitized notice', () => {
    const { board, log } = fixture();
    const restart = vi.fn();
    const local = createLocalWork(board, log, restart);

    local.failed('local refresh', new WorkRecordError('schema-too-new', 'private schema version 999'));
    local.succeeded('local refresh');
    local.failed('stats', new Error('secret'));
    expect(local.blocked()).toBe(true);
    expect(board.snapshot().localProblem).toBe('Restart Lar Factory to continue.');
    expect(board.snapshot().error).toBe('Restart Lar Factory to continue.');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join()).not.toContain('999');
    expect(restart).toHaveBeenCalledExactlyOnceWith('Restart Lar Factory to continue.');
});

test('periodic work catches sync and async failures without exposing unexpected error details', async () => {
    const { board, local } = fixture();

    local.run('local refresh', () => {
        throw new Error('private token');
    });
    expect(board.snapshot().localProblem).toContain('Diagnostics');
    expect(board.snapshot().localProblem).not.toContain('private token');
    local.run('local refresh', async () => {
        throw new WorkRecordError('busy', 'Database locked.');
    });
    await Promise.resolve();
    expect(board.snapshot().localProblem).toContain('Database locked.');
});
