import { afterEach, expect, it, vi } from 'vite-plus/test';

import { boardSessionAuthority } from './board-session.ts';
import { executionModels, readExecutionModels } from './execution-capabilities.ts';
import { subscribeProjects } from './project-subscription.ts';
import { serverRuntimeOrigin } from './t3-settings.ts';

vi.mock('./board-session.ts');
vi.mock('./project-subscription.ts');
vi.mock('./t3-settings.ts');
afterEach(() => {
    vi.resetAllMocks();
    vi.useRealTimers();
    vi.unstubAllEnvs();
});

const snapshot = {
    type: 'snapshot',
    config: {
        secret: 'never-export',
        providers: [
            {
                instanceId: 'account',
                enabled: true,
                installed: true,
                status: 'ready',
                auth: { status: 'authenticated' },
                config: { token: 'never-export' },
                models: [
                    {
                        slug: 'model',
                        capabilities: {
                            optionDescriptors: [
                                { id: 'effort', type: 'select', options: [{ id: 'high' }, { id: 'low' }] },
                                { id: 'fastMode', type: 'boolean' },
                            ],
                        },
                    },
                ],
            },
        ],
    },
};

it('reads model-specific options and only exports the execution allowlist', () => {
    expect(executionModels(snapshot)).toEqual([
        {
            instanceId: 'account',
            model: 'model',
            options: [
                { id: 'effort', values: ['high', 'low'] },
                { id: 'fastMode', values: [true, false] },
            ],
        },
    ]);

    const disabled = structuredClone(snapshot);

    disabled.config.providers[0]!.enabled = false;
    expect(executionModels(disabled)[0]!.problem).toMatch(/disabled/);
    expect(() => executionModels({})).toThrow(/did not report/);
});

it('uses a bounded read-only subscription and revokes the session', async () => {
    vi.mocked(serverRuntimeOrigin).mockReturnValue('');

    const revoke = vi.fn(async () => {});

    vi.mocked(boardSessionAuthority).mockReturnValue({
        issue: async () => ({ sessionId: 's', token: 'secret', expiresAt: '2099-01-01' }),
        revoke,
    });
    vi.mocked(serverRuntimeOrigin).mockReturnValue('');
    // An invalid endpoint must fail before a subscription and still release its session.
    await expect(readExecutionModels()).rejects.toThrow(/Invalid local/);
    expect(subscribeProjects).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('s');
});

it('reads live capabilities and closes the subscription after the snapshot', async () => {
    vi.mocked(serverRuntimeOrigin).mockReturnValue('http://localhost:3773');

    const revoke = vi.fn(async () => {});
    const stop = vi.fn();

    vi.mocked(boardSessionAuthority).mockReturnValue({
        issue: async () => ({ sessionId: 's', token: 'secret', expiresAt: '2099-01-01' }),
        revoke,
    });
    vi.mocked(subscribeProjects).mockImplementation((_origin, _version, _protocol, _change, request) => {
        request!.accept(snapshot);

        return stop;
    });
    expect(await readExecutionModels()).toEqual(executionModels(snapshot));
    expect(vi.mocked(subscribeProjects).mock.calls[0]![4]!.tag).toBe('subscribeServerConfig');
    expect(stop).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('s');
});

it('times out a silent server and releases the read session', async () => {
    vi.useFakeTimers();
    vi.mocked(serverRuntimeOrigin).mockReturnValue('http://localhost:3773');

    const revoke = vi.fn(async () => {});
    const stop = vi.fn();

    vi.mocked(boardSessionAuthority).mockReturnValue({
        issue: async () => ({ sessionId: 's', token: 'secret', expiresAt: '2099-01-01' }),
        revoke,
    });
    vi.mocked(subscribeProjects).mockReturnValue(stop);

    const result = readExecutionModels().catch((error: Error) => error.message);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toMatch(/timed out/);
    expect(stop).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith('s');
});
