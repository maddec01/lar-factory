// Spawned board fixtures supply public T3 capabilities and execution evidence; never contact a real T3.
import type { ExecutionModel } from '@lar-factory/shared/execution-target';
import { readFileSync } from 'node:fs';

import { loadModelChoices } from '../src/t3/model-choices.ts';

export async function readExecutionModels(): Promise<ExecutionModel[]> {
    return loadModelChoices(
        process.env.T3_SETTINGS!,
        new URL('./model-manifest.sample.json', import.meta.url).pathname,
    ).flatMap((group) =>
        group.models.map((model) => ({
            instanceId: group.instanceId,
            model: model.slug,
            options: [
                {
                    id: group.instanceId.startsWith('codex') ? 'reasoningEffort' : 'effort',
                    values: ['low', 'medium', 'high'],
                },
            ],
        })),
    );
}

export async function readExecutionProjection(threadId: string) {
    const calls = readFileSync(`${process.env.FAKE_GH_STATE}.t3calls`, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
    const launch = calls.filter((call) => call[0] === 'launch').at(-1);

    return {
        thread: {
            id: threadId,
            modelSelection:
                launch?.[3] ?? JSON.parse(readFileSync(process.env.T3_SETTINGS!, 'utf8')).defaultModelSelection,
        },
        runs: [],
    };
}
