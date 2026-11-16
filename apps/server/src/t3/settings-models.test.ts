import { expect, test } from 'vite-plus/test';

import { settingsModelChoices } from './settings-models.ts';

const groups = [{ instanceId: 'codex-work', name: 'Work', models: [{ slug: 'model-a', label: 'Model A' }] }];

test('reads only advertised reasoningEffort options for the matching provider instance and model', () => {
    const config = {
        secret: 'never send',
        providers: [
            {
                instanceId: 'codex-work',
                secret: 'never send',
                models: [
                    {
                        slug: 'model-a',
                        capabilities: {
                            optionDescriptors: [
                                {
                                    id: 'reasoningEffort',
                                    type: 'select',
                                    options: [{ id: 'high', label: 'High', secret: 'never send' }, { id: false }],
                                },
                                { id: 'serviceTier', type: 'select', options: [{ id: 'fast', label: 'Fast' }] },
                            ],
                        },
                    },
                ],
            },
        ],
    };

    expect(settingsModelChoices(groups, config)).toEqual([
        { ...groups[0], models: [{ ...groups[0]!.models[0], efforts: [{ value: 'high', label: 'High' }] }] },
    ]);
});
