import { executionSettingsOf } from '@lar-factory/shared/execution-target';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { executionReport, verifyExecution } from './execution-report.ts';
import { sendThreadCommand } from './thread-commands.ts';

vi.mock('./thread-commands.ts');
afterEach(() => vi.resetAllMocks());

const selection = { instanceId: 'codex', model: 'sol', options: [{ id: 'reasoningEffort', value: 'high' }] };
const projection = {
    thread: { id: 'thread', modelSelection: selection },
    runs: [{ id: 'run', status: 'running', modelSelection: selection }],
};

it('records the actual run selection, not the next-turn selection or the requested values', async () => {
    expect(
        executionReport(
            { ...projection, thread: { id: 'thread', modelSelection: { ...selection, model: 'different' } } },
            'thread',
        ),
    ).toEqual({ source: 't3', reference: 'run', actual: executionSettingsOf(selection) });
    expect(executionReport({}, 'thread')).toBeNull();
    expect(executionReport(projection, 'other')).toBeNull();
    expect((await verifyExecution(projection, 'thread', executionSettingsOf(selection))).failure).toBeNull();
    expect(sendThreadCommand).not.toHaveBeenCalled();
});

it('interrupts a mismatched live run, reports requested versus actual, and exposes an unconfirmed interrupt', async () => {
    vi.mocked(sendThreadCommand).mockResolvedValue({ outcome: 'unconfirmed', reason: 'offline' });

    const result = await verifyExecution(projection, 'thread', { ...executionSettingsOf(selection), effort: 'low' });

    expect(result.failure).toMatch(/requested.*low.*reported.*high.*Interrupt not confirmed: offline/);
    expect(result.report?.actual.effort).toBe('high');
    expect(sendThreadCommand).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'run.interrupt', threadId: 'thread', runId: 'run' }),
    );
});

it('keeps missing or contradictory run evidence unknown instead of substituting the thread selection', () => {
    expect(executionReport({ ...projection, runs: [{ id: 'run' }] }, 'thread')).toBeNull();
    expect(
        executionReport(
            {
                ...projection,
                runs: [
                    {
                        id: 'run',
                        modelSelection: {
                            ...selection,
                            options: [
                                { id: 'reasoningEffort', value: 'high' },
                                { id: 'reasoningEffort', value: 'low' },
                            ],
                        },
                    },
                ],
            },
            'thread',
        ),
    ).toBeNull();
});
