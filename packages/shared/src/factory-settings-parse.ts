import { migrateReviewerEdits, type LegacyReviewer } from './factory-settings-migrate.ts';
import {
    BUILTIN_REVIEWERS,
    builtinReviewerMode,
    FACTORY_ROLES,
    THREAD_KINDS,
    defaultFactorySettings,
    type ExecutionOverride,
    type FactorySettings,
    type ReviewerDefinition,
    type ReviewerMode,
} from './factory-settings.ts';
import { isRecord } from './is-record.ts';

const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const id = (value: unknown): value is string => text(value) && /^[a-z][a-z0-9-]*$/.test(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[]) =>
    Object.keys(value).every((key) => allowed.includes(key));
const integer = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;

function override(value: unknown): value is ExecutionOverride {
    if (!isRecord(value) || !keys(value, ['model', 'effort'])) return false;

    if (value.effort !== undefined && !text(value.effort)) return false;

    const model = value.model;

    return (
        model === undefined ||
        (isRecord(model) && keys(model, ['instanceId', 'model']) && text(model.instanceId) && text(model.model))
    );
}

function mode(value: unknown): value is ReviewerMode {
    if (!isRecord(value)) return false;

    if (value.kind === 'always' || value.kind === 'never') return keys(value, ['kind']);

    if (value.kind !== 'on-trigger' || !keys(value, ['kind', 'trigger'])) return false;

    const rule = value.trigger;

    if (!isRecord(rule) || rule.version !== 1) return false;

    if (rule.kind === 'policy')
        return (
            keys(rule, ['version', 'kind', 'policy']) &&
            typeof rule.policy === 'string' &&
            ['security', 'ui', 'performance'].includes(rule.policy)
        );

    return (
        rule.kind === 'rules' &&
        keys(rule, ['version', 'kind', 'any']) &&
        Array.isArray(rule.any) &&
        rule.any.length > 0 &&
        rule.any.every(
            (entry) =>
                isRecord(entry) &&
                keys(entry, ['target', 'pattern']) &&
                typeof entry.target === 'string' &&
                ['path-glob', 'diff-text'].includes(entry.target) &&
                text(entry.pattern),
        )
    );
}

function reviewer(value: unknown, legacy: boolean): LegacyReviewer | ReviewerDefinition | null {
    if (
        !isRecord(value) ||
        !keys(value, ['id', 'name', 'mode', 'instructions', 'revisions', 'trigger']) ||
        !id(value.id) ||
        !text(value.name)
    )
        return null;

    const chosenMode =
        value.mode === undefined
            ? (defaultFactorySettings().reviewers.find((entry) => entry.id === value.id)?.mode ?? { kind: 'always' })
            : value.mode;
    const revisions = value.revisions === undefined ? [] : value.revisions;

    if (
        !mode(chosenMode) ||
        (value.trigger !== undefined && !mode({ kind: 'on-trigger', trigger: value.trigger })) ||
        !Array.isArray(revisions) ||
        !revisions.every(
            (entry, index) =>
                isRecord(entry) &&
                keys(entry, ['revision', 'text']) &&
                entry.revision === index + 1 &&
                text(entry.text),
        )
    )
        return null;

    const instruction = value.instructions;

    if (!isRecord(instruction)) return null;

    if (instruction.kind === 'builtin') {
        if (
            !keys(instruction, ['kind', 'reviewer']) ||
            instruction.reviewer !== value.id ||
            !BUILTIN_REVIEWERS.includes(value.id as never)
        )
            return null;
    } else if (instruction.kind === 'revision') {
        if (
            !keys(instruction, ['kind', 'revision']) ||
            !integer(instruction.revision) ||
            instruction.revision > revisions.length
        )
            return null;
    } else return null;

    if (!legacy && BUILTIN_REVIEWERS.includes(value.id as never)) {
        const builtin = defaultFactorySettings().reviewers.find((entry) => entry.id === value.id)!;

        if (
            instruction.kind !== 'builtin' ||
            value.revisions !== undefined ||
            value.trigger !== undefined ||
            value.name !== builtin.name
        )
            return null;

        const packagedMode = builtinReviewerMode(value.id as never, chosenMode.kind);

        if (chosenMode.kind === 'on-trigger') {
            const trigger = chosenMode.trigger;

            if (value.id === 'code') {
                if (
                    trigger.kind !== 'rules' ||
                    trigger.any.length !== 1 ||
                    trigger.any[0]!.target !== 'path-glob' ||
                    trigger.any[0]!.pattern !== '**'
                )
                    return null;
            } else if (trigger.kind !== 'policy' || trigger.policy !== value.id) return null;
        }

        return { ...builtin, mode: packagedMode };
    }

    return {
        id: value.id,
        name: value.name,
        mode: chosenMode,
        ...(value.trigger !== undefined ? { trigger: value.trigger } : {}),
        instructions: instruction,
        revisions,
    } as LegacyReviewer;
}

/** Missing pre-feature settings migrate to today's policy. Invalid supplied values throw; they never silently reset choices. */
export function parseFactorySettings(value: unknown): FactorySettings {
    if (value === undefined) return defaultFactorySettings();

    const invalid = () =>
        new Error(
            'Invalid factory settings: expected version 2 (or legacy version 1), known kinds and roles, and valid reviewer definitions.',
        );

    if (
        !isRecord(value) ||
        !keys(value, ['version', 'threadKinds', 'roles', 'reviewers']) ||
        (value.version !== 1 && value.version !== 2)
    )
        throw invalid();

    const kinds = value.threadKinds === undefined ? {} : value.threadKinds;
    const roles = value.roles === undefined ? {} : value.roles;
    const supplied = value.reviewers === undefined ? [] : value.reviewers;

    if (
        !isRecord(kinds) ||
        !keys(kinds, THREAD_KINDS) ||
        !Object.values(kinds).every(override) ||
        !isRecord(roles) ||
        !Array.isArray(supplied)
    )
        throw invalid();

    const parsed = supplied.map((entry) => reviewer(entry, value.version === 1));

    if (parsed.some((entry) => entry === null)) throw invalid();

    const reviewers = parsed as ReviewerDefinition[];

    if (new Set(reviewers.map((entry) => entry.id)).size !== reviewers.length) throw invalid();

    for (const builtin of defaultFactorySettings().reviewers) {
        if (!reviewers.some((entry) => entry.id === builtin.id)) reviewers.push(builtin);
    }

    const roleNames = [...FACTORY_ROLES, ...reviewers.map((entry) => `reviewer:${entry.id}`)];

    if (!keys(roles, roleNames) || !Object.values(roles).every(override)) throw invalid();

    const settings = structuredClone({ version: 2, threadKinds: kinds, roles, reviewers }) as FactorySettings;

    return value.version === 1 ? migrateReviewerEdits(settings) : settings;
}
