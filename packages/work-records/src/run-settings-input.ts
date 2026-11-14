import { isRecord, type ModelSelection } from '@lar-factory/shared';
import {
    FACTORY_ROLES,
    THREAD_KINDS,
    parseFactorySettings,
    resolveFactorySettings,
    reviewerInstructions,
} from '@lar-factory/shared/factory-settings';
import type {
    ExecutionSettings,
    ReviewSelectionEvidence,
    RunSettings,
    SnapshotRunInput,
} from '@lar-factory/shared/run-settings';
import { createHash } from 'node:crypto';

import { WorkRecordError } from './database.ts';

export const invalidRun = (message: string): never => {
    throw new WorkRecordError('invalid', message);
};
export const runText = (value: unknown): string =>
    typeof value === 'string' && value.trim() && !value.includes('\0')
        ? value
        : invalidRun('Expected nonempty run text without NUL.');
export const runObject = (value: unknown, keys: string[]): Record<string, unknown> => {
    if (!isRecord(value) || Object.keys(value).some((key) => !keys.includes(key)))
        invalidRun('Invalid run record fields.');

    return value as Record<string, unknown>;
};

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

export function executionSettings(value: unknown): ExecutionSettings {
    const input = runObject(value, ['model', 'effort', 'options']);
    const model = input.model === null ? null : runObject(input.model, ['instanceId', 'model']);

    if (!Array.isArray(input.options)) invalidRun('Execution options must be a list.');

    const options = (input.options as unknown[]).map((entry) => {
        const option = runObject(entry, ['id', 'value']);

        if (typeof option.value !== 'string' && typeof option.value !== 'boolean')
            invalidRun('Invalid model option value.');

        return { id: runText(option.id), value: option.value as string | boolean };
    });

    if (new Set(options.map((option) => option.id)).size !== options.length) invalidRun('Duplicate execution option.');

    const effort = input.effort === null ? null : runText(input.effort);

    if (options.some((option) => ['effort', 'reasoningEffort'].includes(option.id) && option.value !== effort))
        invalidRun('Execution effort conflicts with its options.');

    return {
        model: model && { instanceId: runText(model.instanceId), model: runText(model.model) },
        effort,
        options,
    };
}

function selection(value: unknown): ModelSelection | null | undefined {
    if (value === undefined || value === null) return value;

    const input = runObject(value, ['instanceId', 'model', 'options']);
    const options = input.options ?? [];
    const effort = Array.isArray(options)
        ? (options.find((option) => isRecord(option) && ['effort', 'reasoningEffort'].includes(String(option.id)))
              ?.value ?? null)
        : null;
    const parsed = executionSettings({ model: { instanceId: input.instanceId, model: input.model }, effort, options });

    return { ...parsed.model!, options: parsed.options };
}

/** Resolve once. Callers cannot supply a pre-resolved snapshot or read arbitrary instruction paths. */
export function captureRunSettings(workId: string, value: SnapshotRunInput, settings: unknown): RunSettings {
    const input = runObject(value, ['runId', 'kind', 'projectDefault', 'threadSelection', 'packaged', 'skills']);
    const runId = runText(input.runId);

    if (!THREAD_KINDS.includes(input.kind as never)) invalidRun('Unknown run kind.');

    const kind = value.kind;
    const parsed = parseFactorySettings(settings);
    const context = {
        projectDefault: selection(input.projectDefault),
        threadSelection: selection(input.threadSelection),
    };
    const packaged = runObject(input.packaged, ['version', 'reviewers']);
    const version = runText(packaged.version);
    const texts = runObject(packaged.reviewers, ['code', 'security', 'ui', 'performance']);

    if (!Array.isArray(input.skills)) invalidRun('Run skills must be a list.');

    const skills = (input.skills as unknown[]).map(runText);

    if (new Set(skills).size !== skills.length) invalidRun('Duplicate run skill.');

    const resolve = (role?: Parameters<typeof resolveFactorySettings>[2]) => {
        const { model, effort, options } = resolveFactorySettings(parsed, kind, role, context);

        return executionSettings({ model, effort, options });
    };
    const roles = Object.fromEntries(
        [...FACTORY_ROLES, ...parsed.reviewers.map((reviewer) => `reviewer:${reviewer.id}` as const)].map((role) => [
            role,
            resolve(role),
        ]),
    ) as RunSettings['roles'];
    const reviewers = parsed.reviewers.map((reviewer) => {
        const selected = reviewerInstructions(reviewer);
        const text = runText('text' in selected ? selected.text : texts[reviewer.id]);

        return {
            id: reviewer.id,
            name: reviewer.name,
            mode: reviewer.mode,
            instructions: {
                source:
                    'text' in selected
                        ? { kind: 'custom' as const, revision: selected.revision }
                        : { kind: 'packaged' as const, version, path: selected.path },
                text,
                digest: digest(text),
            },
        };
    });

    return {
        version: 1,
        runId,
        workId,
        kind,
        capturedAt: new Date().toISOString(),
        settingsDigest: digest(JSON.stringify(parsed)),
        triggerVersion: 1,
        settings: parsed,
        thread: resolve(),
        roles,
        reviewers,
        skills,
    };
}

export function reviewSelection(value: unknown, verdict: string): ReviewSelectionEvidence {
    const input = runObject(value, ['triggerVersion', 'outcome', 'rule', 'evidence', 'reason', 'run']);

    if (
        (input.triggerVersion !== 1 && input.triggerVersion !== 2) ||
        !['matched', 'unmatched', 'uncertain'].includes(String(input.outcome)) ||
        typeof input.run !== 'boolean' ||
        input.run !== (verdict !== 'skipped')
    )
        invalidRun('Review selection must use version 1 or 2 and agree with the recorded verdict.');

    return {
        triggerVersion: input.triggerVersion as 1 | 2,
        outcome: input.outcome as ReviewSelectionEvidence['outcome'],
        run: input.run as boolean,
        rule: runText(input.rule),
        evidence: runText(input.evidence),
        reason: runText(input.reason),
    };
}
