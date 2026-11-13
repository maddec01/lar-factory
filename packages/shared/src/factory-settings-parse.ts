import {
    BUILTIN_REVIEWERS,
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

function reviewer(value: unknown): ReviewerDefinition | null {
    if (
        !isRecord(value) ||
        !keys(value, ['id', 'name', 'mode', 'instructions', 'revisions']) ||
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

    return {
        id: value.id,
        name: value.name,
        mode: chosenMode,
        instructions: instruction,
        revisions,
    } as ReviewerDefinition;
}

/** Missing pre-feature settings migrate to today's policy. Invalid supplied values throw; they never silently reset choices. */
export function parseFactorySettings(value: unknown): FactorySettings {
    if (value === undefined) return defaultFactorySettings();

    const invalid = () =>
        new Error(
            'Invalid factory settings: expected version 1, known kinds and roles, and valid reviewer definitions.',
        );

    if (!isRecord(value) || !keys(value, ['version', 'threadKinds', 'roles', 'reviewers']) || value.version !== 1)
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

    const parsed = supplied.map(reviewer);

    if (parsed.some((entry) => entry === null)) throw invalid();

    const reviewers = parsed as ReviewerDefinition[];

    if (new Set(reviewers.map((entry) => entry.id)).size !== reviewers.length) throw invalid();

    for (const builtin of defaultFactorySettings().reviewers) {
        if (!reviewers.some((entry) => entry.id === builtin.id)) reviewers.push(builtin);
    }

    const roleNames = [...FACTORY_ROLES, ...reviewers.map((entry) => `reviewer:${entry.id}`)];

    if (!keys(roles, roleNames) || !Object.values(roles).every(override)) throw invalid();

    return structuredClone({ version: 1, threadKinds: kinds, roles, reviewers }) as FactorySettings;
}

/** Make an editable copy of instructions without changing the built-in file or any previous revision. */
export function reviseReviewerInstructions(
    settings: FactorySettings,
    reviewerId: string,
    instructions: string,
): FactorySettings {
    const next = parseFactorySettings(settings);
    const target = next.reviewers.find((entry) => entry.id === reviewerId);

    if (!target || !text(instructions)) throw new Error('A known reviewer and non-empty instructions are required.');

    const revision = target.revisions.length + 1;

    target.revisions.push({ revision, text: instructions });
    target.instructions = { kind: 'revision', revision };

    return next;
}
