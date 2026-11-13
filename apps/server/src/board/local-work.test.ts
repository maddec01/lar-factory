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

test('a later successful refresh clears its warning and a second failure is reported again', () => {
    const { board, log, local } = fixture();
    const error = new WorkRecordError('busy', 'The work-record database is locked by another writer; try again.');

    local.failed('local refresh', error);
    local.failed('local refresh', error);
    expect(log).toHaveBeenCalledTimes(1);
    local.succeeded('local refresh');
    expect(board.snapshot().localProblem).toBeUndefined();
    local.failed('local refresh', error);
    expect(log).toHaveBeenCalledTimes(3); // failure, recovery, failure
});

test('different operations recover independently and explain a refused record read', () => {
    const { board, local } = fixture();

    local.failed(
        'local refresh',
        new WorkRecordError('invalid', 'Work record work-17 (acme/app#17): invalid saved scope.'),
    );
    expect(board.snapshot().localProblem).toContain('work-17 (acme/app#17): invalid saved scope.');
    expect(board.snapshot().localProblem).toContain('retry');
    local.failed('Spec sync', new WorkRecordError('busy', 'Database locked.'));
    local.succeeded('stats');
    local.succeeded('Spec sync');
    expect(board.snapshot().localProblem).toContain('invalid saved scope.');
    local.succeeded('local refresh');
    expect(board.snapshot().localProblem).toBeUndefined();
});

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

test('skipped work and a success begun before a newer failure cannot clear that failure', async () => {
    const { board, local } = fixture();
    let finish = () => {};

    local.run(
        'local refresh',
        () =>
            new Promise<void>((resolve) => {
                finish = resolve;
            }),
    );
    local.failed('local refresh', new WorkRecordError('invalid', 'Newer invalid record.'));
    finish();
    await Promise.resolve();
    local.run('local refresh', () => false);
    await Promise.resolve();
    expect(board.snapshot().localProblem).toContain('Newer invalid record.');
    local.run('local refresh', () => {});
    await Promise.resolve();
    expect(board.snapshot().localProblem).toBeUndefined();
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
