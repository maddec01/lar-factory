// Auto-build: this machine's choice to have the board start eligible Ready builds by itself, and the model it starts
// them on. Off by default, and a file the board can't use reads as off.

import { isRecord, type AutoBuild, type ModelChoice } from '@lar-factory/shared';

import { machineSetting } from './machine-setting.ts';

const modelChoice = (model: unknown): ModelChoice | null =>
    isRecord(model) && typeof model.instanceId === 'string' && typeof model.model === 'string'
        ? { instanceId: model.instanceId, model: model.model }
        : null;

const autoBuildSetting = machineSetting<AutoBuild>({
    file: 'auto-build.json',
    name: 'Auto-build',
    fallback: { on: false },
    needs: 'needs "on" as true or false, and a model choice or none',
    parse(json) {
        if (!isRecord(json) || typeof json.on !== 'boolean') return null;

        if (json.model === undefined) return { on: json.on };

        const model = modelChoice(json.model);

        return model && { on: json.on, model };
    },
});

export const readAutoBuild = autoBuildSetting.read;
export const writeAutoBuild = autoBuildSetting.write;
