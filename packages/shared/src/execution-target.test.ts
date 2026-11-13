import { describe, expect, it } from 'vite-plus/test';

import { executionMismatch, executionSettingsOf, executionTarget, type ExecutionModel } from './execution-target.ts';

const models: ExecutionModel[] = [
    {
        instanceId: 'claude-work',
        model: 'opus',
        options: [
            { id: 'effort', values: ['low', 'high'] },
            { id: 'fastMode', values: [true, false] },
        ],
    },
    { instanceId: 'codex-work', model: 'sol', options: [{ id: 'reasoningEffort', values: ['medium', 'high'] }] },
];

describe('exact execution targets', () => {
    for (const capability of models)
        it(`uses ${capability.options[0]!.id} for ${capability.instanceId}`, () => {
            const request = {
                model: { instanceId: capability.instanceId, model: capability.model },
                effort: 'high',
                options: [],
            };
            const selection = executionTarget(request, models);

            expect(selection).toEqual({
                ...request.model,
                options: [{ id: capability.options[0]!.id, value: 'high' }],
            });
            expect(executionMismatch(request, executionSettingsOf(selection))).toBeNull();
        });

    it('holds unavailable models, providers, efforts and other options without changing the request', () => {
        const request = { model: { instanceId: 'codex-work', model: 'sol' }, effort: 'high', options: [] };

        expect(() => executionTarget(request, [])).toThrow(/codex-work\/sol.*unavailable/);
        expect(() => executionTarget(request, [{ ...models[1]!, problem: 'Provider is disabled.' }])).toThrow(
            /disabled/,
        );
        expect(() => executionTarget({ ...request, effort: 'ultra' }, models)).toThrow(/reasoningEffort=ultra/);
        expect(() => executionTarget({ ...request, options: [{ id: 'fastMode', value: true }] }, models)).toThrow(
            /fastMode=true/,
        );
        expect(() => executionTarget({ ...request, model: null }, models)).toThrow(/no resolved/);
        expect(request.options).toEqual([]);
    });

    it('leaves default effort unspecified and never invents actual settings', () => {
        const selection = { instanceId: 'claude-work', model: 'opus', options: [] };

        expect(executionTarget(executionSettingsOf(selection), models)).toEqual(selection);
        expect(executionSettingsOf(selection).effort).toBeNull();
        expect(
            executionMismatch({ ...executionSettingsOf(selection), effort: 'high' }, executionSettingsOf(selection)),
        ).toMatch(/requested.*reported/);
        expect(
            executionMismatch(executionSettingsOf(selection), { ...executionSettingsOf(selection), model: null }),
        ).toMatch(/mismatch/);
    });
});
