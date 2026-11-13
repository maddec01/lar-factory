import type { ModelSelection } from './board-domain.ts';
import type { ExecutionSettings } from './run-settings.ts';

/** Only public execution capabilities, never provider configuration or credentials. */
export interface ExecutionModel {
    instanceId: string;
    model: string;
    problem?: string;
    options: { id: string; values: (string | boolean)[] }[];
}

/** An unsupported request holds; options are never filtered or replaced with defaults. */
export function executionTarget(request: ExecutionSettings, models: readonly ExecutionModel[]): ModelSelection {
    if (!request.model) throw new Error('The run has no resolved T3 project model. Set a project or kind model.');

    const { instanceId, model } = request.model;
    const capability = models.find((entry) => entry.instanceId === instanceId && entry.model === model);

    if (!capability) throw new Error(`Configured model ${instanceId}/${model} is unavailable in T3.`);

    if (capability.problem) throw new Error(`${instanceId}/${model}: ${capability.problem}`);

    const options = request.options.filter((option) => !['effort', 'reasoningEffort'].includes(option.id));

    if (request.effort !== null) {
        const effort = capability.options.find((option) => ['effort', 'reasoningEffort'].includes(option.id));

        if (!effort) throw new Error(`${instanceId}/${model} does not offer configured effort ${request.effort}.`);

        options.push({ id: effort.id, value: request.effort });
    }

    for (const option of options) {
        if (!capability.options.some((entry) => entry.id === option.id && entry.values.includes(option.value)))
            throw new Error(`${instanceId}/${model} does not offer ${option.id}=${String(option.value)}.`);
    }

    return { instanceId, model, options };
}

/** Normalize an actual selection without claiming any unreported provider defaults. */
export function executionSettingsOf(selection: ModelSelection): ExecutionSettings {
    const effort = selection.options?.find((option) => ['effort', 'reasoningEffort'].includes(option.id))?.value;

    return {
        model: { instanceId: selection.instanceId, model: selection.model },
        effort: typeof effort === 'string' ? effort : null,
        options: selection.options?.filter((option) => !['effort', 'reasoningEffort'].includes(option.id)) ?? [],
    };
}

export function executionMismatch(requested: ExecutionSettings, actual: ExecutionSettings): string | null {
    const options = (value: ExecutionSettings) =>
        JSON.stringify(
            [...value.options]
                .filter((option) => !['effort', 'reasoningEffort'].includes(option.id))
                .sort((a, b) => a.id.localeCompare(b.id)),
        );

    return requested.model?.instanceId !== actual.model?.instanceId ||
        requested.model?.model !== actual.model?.model ||
        (requested.effort !== null && requested.effort !== actual.effort) ||
        options(requested) !== options(actual)
        ? `T3 execution mismatch: requested ${JSON.stringify(requested)}; reported ${JSON.stringify(actual)}. Hold this run; do not substitute a model or option.`
        : null;
}
