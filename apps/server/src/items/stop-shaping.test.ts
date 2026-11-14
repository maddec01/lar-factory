import { expect, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { createShapingControl } from './stop-shaping.ts';

test('Stop interrupts only the recorded shaping owner and keeps all work records', async () => {
    const send = vi.fn(async () => ({ outcome: 'accepted' as const, sequence: 1 }));
    const records = {
        read: vi.fn(() => ({ status: 'Shaping', finishedAt: null, setAside: null })),
        threads: vi.fn(() => [
            { threadId: 'shape', purpose: 'shape', deletedAt: null },
            { threadId: 'old-build', purpose: 'build' },
        ]),
    };
    const board = createBoardState({
        items: [{ id: 'work', status: 'Shaping', threads: [{ id: 'shape', purpose: 'shape', state: 'running' }] }],
        repos: [],
    } as never);
    const commands = createShapingControl({
        board,
        records: records as never,
        reread: vi.fn(),
        send,
        projection: async () => ({ runs: [{ id: 'run', status: 'running' }] }),
    });

    expect((await commands.stopShaping('work')).status).toBe(200);
    expect(send).toHaveBeenCalledExactlyOnceWith({
        type: 'run.interrupt',
        commandId: expect.any(String),
        threadId: 'shape',
        runId: 'run',
    });
    expect(records.read().status).toBe('Shaping');
});

for (const projection of [null, { runs: [] }, { runs: [{ id: 'old', status: 'completed' }] }])
    test('Stop refuses unknown or ended activity without pretending to interrupt', async () => {
        const send = vi.fn();
        const board = createBoardState({ items: [{ id: 'work' }], repos: [] } as never);
        const records = {
            read: () => ({ status: 'Shaping', finishedAt: null, setAside: null }),
            threads: () => [{ threadId: 'shape', purpose: 'shape' }],
        };
        const commands = createShapingControl({
            board,
            records: records as never,
            reread: vi.fn(),
            send,
            projection: async () => projection,
        });

        expect((await commands.stopShaping('work')).status).toBe(409);
        expect(send).not.toHaveBeenCalled();
    });
