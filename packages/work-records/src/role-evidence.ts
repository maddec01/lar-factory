import { isRecord } from '@lar-factory/shared';
import { executionMismatch, executionSettingsOf } from '@lar-factory/shared/execution-target';
import type { ExecutionModel } from '@lar-factory/shared/execution-target';
import type { RoleRun, RoleRunFinish } from '@lar-factory/shared/run-settings';

import { executionSettings, runText } from './run-settings-input.ts';

/** Accept the structured tool payload or its MCP structuredContent envelope, never agent-authored selections. */
function payload(input: unknown): Record<string, unknown> {
    if (isRecord(input) && isRecord(input.structuredContent)) input = input.structuredContent;

    if (!isRecord(input)) throw new Error('Expected T3 JSON object.');

    return input;
}

/** Keep unavailable instances in the list with a problem; never infer model families from their names. */
export function roleCapabilities(input: unknown): ExecutionModel[] {
    const value = payload(input);

    if (!Array.isArray(value.providers)) throw new Error('T3 capabilities must include providers.');

    return value.providers.flatMap((provider) => {
        if (!isRecord(provider) || !Array.isArray(provider.models)) throw new Error('Invalid T3 provider.');

        return provider.models.map((model): ExecutionModel => {
            if (!isRecord(model)) throw new Error('Invalid T3 model.');

            const options = model.options ?? [];

            if (!Array.isArray(options)) throw new Error('Invalid T3 capability options.');

            return {
                instanceId: runText(provider.providerInstanceId),
                model: runText(model.id),
                ...(provider.canRunChildTask !== true && { problem: 'T3 provider cannot run child tasks.' }),
                options: options.map((option) => {
                    if (
                        !isRecord(option) ||
                        !Array.isArray(option.values) ||
                        option.values.some((entry) => typeof entry !== 'string' && typeof entry !== 'boolean')
                    )
                        throw new Error('Invalid T3 capability option.');

                    return { id: runText(option.id), values: option.values as (string | boolean)[] };
                }),
            };
        });
    });
}

/** Missing or malformed evidence stays unknown and holds; only T3's terminal result can complete an attempt. */
export function roleFinish(attempt: RoleRun, input: unknown): RoleRunFinish {
    let report: RoleRunFinish['report'] = null;
    let failure: string | null;
    let detail: string | undefined;

    try {
        const value = payload(input);
        const model = value.executedModel ?? value.model;

        detail = typeof value.summary === 'string' ? value.summary : undefined;

        if (!Array.isArray(value.options)) throw new Error('T3 did not report execution options.');

        const effort = value.options.find(
            (option) => isRecord(option) && ['effort', 'reasoningEffort'].includes(String(option.id)),
        );
        const actual = executionSettings({
            model: { instanceId: value.providerInstanceId, model },
            effort: isRecord(effort) ? effort.value : null,
            options: value.options.map((option) => {
                if (!isRecord(option)) throw new Error('Invalid T3 execution option.');

                return { id: option.id, value: option.value };
            }),
        });

        if (actual.options.filter((option) => ['effort', 'reasoningEffort'].includes(option.id)).length > 1)
            throw new Error('T3 reported conflicting effort options.');

        report = {
            source: 't3',
            reference: runText(value.taskId),
            actual: executionSettingsOf({ ...actual.model!, options: actual.options }),
        };
        failure = executionMismatch(attempt.requested, report.actual);

        const sorted = (options: typeof actual.options) =>
            JSON.stringify([...options].sort((a, b) => a.id.localeCompare(b.id)));

        if (!failure && attempt.launchOptions && sorted(attempt.launchOptions) !== sorted(actual.options))
            failure = `T3 execution options mismatch: requested ${JSON.stringify(attempt.launchOptions)}; reported ${JSON.stringify(actual.options)}.`;

        if (!failure && attempt.requested.effort !== report.actual.effort)
            failure = `T3 execution mismatch: requested ${JSON.stringify(attempt.requested)}; reported ${JSON.stringify(report.actual)}.`;

        if (!failure && (value.status !== 'completed' || value.hasPendingChildRuns !== false))
            failure = `T3 task ${report.reference} is not finished successfully (${String(value.status)}, pending children: ${String(value.hasPendingChildRuns)}).${detail ? ` ${detail}` : ''}`;
    } catch (error) {
        failure = `Cannot verify T3 execution: ${(error as Error).message}${detail ? ` ${detail}` : ''}`;
    }

    return {
        executionId: attempt.executionId,
        ...(detail?.trim() && { summary: detail.slice(0, 10000) }),
        report,
        result: failure ? 'failed' : 'completed',
        ...(failure && { failure }),
    };
}
