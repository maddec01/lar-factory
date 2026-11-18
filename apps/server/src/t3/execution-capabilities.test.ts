import { afterEach, expect, it, vi } from 'vite-plus/test';

import { executionModels, readExecutionModels } from './execution-capabilities.ts';
import { subscribeProjects } from './project-subscription.ts';
import { serverRuntimeOrigin } from './t3-settings.ts';

vi.mock('./project-subscription.ts');
vi.mock('./t3-settings.ts');
afterEach(() => {
    vi.resetAllMocks();
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

it('reads live capabilities and closes the subscription after the snapshot', async () => {
    vi.mocked(serverRuntimeOrigin).mockReturnValue('http://localhost:3773');

    const stop = vi.fn();

    vi.mocked(subscribeProjects).mockImplementation((_origin, _version, _protocol, _change, request) => {
        request!.accept(snapshot);

        return stop;
    });
    expect(await readExecutionModels()).toEqual(executionModels(snapshot));
    expect(vi.mocked(subscribeProjects).mock.calls[0]![4]!.tag).toBe('subscribeServerConfig');
    expect(stop).toHaveBeenCalledOnce();
});
