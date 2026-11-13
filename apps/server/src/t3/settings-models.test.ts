import { expect, test } from 'vite-plus/test';

import { settingsModelChoices } from './settings-models.ts';

const groups = [{ instanceId: 'codex-work', name: 'Work', models: [{ slug: 'model-a', label: 'Model A' }] }];

test.each(['reasoningEffort', 'effort'])(
    'reads only advertised %s options for the matching provider instance and model',
    (id) => {
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
                                        id,
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
    },
);

test('unavailable T3 or malformed capabilities invent no effort choices', () => {
    expect(settingsModelChoices(groups, null)[0]!.models[0]!.efforts).toBeUndefined();
    expect(
        settingsModelChoices(groups, { providers: [{ instanceId: 'other' }] })[0]!.models[0]!.efforts,
    ).toBeUndefined();
});
