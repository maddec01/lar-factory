import { describe, expect, it } from 'vite-plus/test';

import { parseFactorySettings, reviseReviewerInstructions } from './factory-settings-parse.ts';
import { resolveFactorySettings, reviewerInstructions } from './factory-settings-resolve.ts';
import { defaultFactorySettings, FACTORY_ROLES, THREAD_KINDS } from './factory-settings.ts';

const projectDefault = {
    instanceId: 'codex',
    model: 'project-model',
    options: [
        { id: 'reasoningEffort', value: 'high' },
        { id: 'fast', value: true },
    ],
};
const other = { instanceId: 'claudeAgent', model: 'another-model' };

it('migrates missing settings to the exact former modes and references, with every role inheriting its thread', () => {
    const defaults = parseFactorySettings(undefined);

    expect(defaults.reviewers.map(({ id, mode }) => [id, mode.kind])).toEqual([
        ['code', 'always'],
        ['security', 'on-trigger'],
        ['ui', 'on-trigger'],
        ['performance', 'on-trigger'],
    ]);
    for (const reviewer of defaults.reviewers)
        expect(reviewerInstructions(reviewer)).toEqual({ path: `skills/lar-build/agents/reviewer-${reviewer.id}.md` });
    for (const kind of THREAD_KINDS) {
        for (const role of [...FACTORY_ROLES, ...defaults.reviewers.map((entry) => `reviewer:${entry.id}` as const)]) {
            expect(resolveFactorySettings(defaults, kind, role, { projectDefault })).toMatchObject({
                model: { instanceId: 'codex', model: 'project-model' },
                effort: 'high',
                options: [{ id: 'fast', value: true }],
            });
        }
    }
    expect(resolveFactorySettings(undefined, 'build')).toMatchObject({ model: null, effort: null });
});

it('resolves kind and role overrides independently and inherits a manually selected owning thread', () => {
    const settings = defaultFactorySettings();

    settings.threadKinds.build = { model: other, effort: 'medium' };
    settings.roles.planner = { effort: 'low' };
    expect(resolveFactorySettings(settings, 'build', 'planner', { projectDefault })).toMatchObject({
        model: other,
        effort: 'low',
        options: [],
    });
    // Store only model identity, never provider options, in overrides.
    settings.roles.implementer = { model: { instanceId: projectDefault.instanceId, model: projectDefault.model } };
    expect(resolveFactorySettings(settings, 'build', 'implementer', { projectDefault })).toMatchObject({
        model: { instanceId: 'codex', model: 'project-model' },
        effort: 'medium',
        options: [{ id: 'fast', value: true }],
    });
    expect(resolveFactorySettings(settings, 'shaping', 'approver', { projectDefault })).toMatchObject({
        effort: 'high',
    });
    expect(
        resolveFactorySettings(settings, 'build', 'approver', {
            projectDefault,
            threadSelection: { ...other, options: [{ id: 'effort', value: 'max' }] },
        }),
    ).toMatchObject({ model: other, effort: 'max' });
});

it('preserves default-model options for an explicit identical kind choice and drops them for a different model', () => {
    const settings = defaultFactorySettings();

    settings.threadKinds.concept = { model: { instanceId: 'codex', model: 'project-model' } };
    expect(resolveFactorySettings(settings, 'concept', undefined, { projectDefault })).toMatchObject({
        effort: 'high',
        options: [{ id: 'fast', value: true }],
    });
    settings.threadKinds.concept.model = other;
    expect(resolveFactorySettings(settings, 'concept', undefined, { projectDefault })).toMatchObject({
        effort: null,
        options: [],
    });
});

it('adds a stable custom reviewer, defaults it to always, retains trigger definitions, and never excludes required roles', () => {
    const settings = parseFactorySettings({
        version: 1,
        reviewers: [
            {
                id: 'accessibility',
                name: 'Accessibility',
                instructions: { kind: 'revision', revision: 1 },
                revisions: [{ revision: 1, text: 'Check keyboard access.' }],
            },
        ],
    });
    const custom = settings.reviewers[0]!;

    expect(custom.mode).toEqual({ kind: 'always' });
    custom.name = 'Keyboard review';
    custom.mode = {
        kind: 'on-trigger',
        trigger: {
            version: 1,
            kind: 'rules',
            any: [
                { target: 'path-glob', pattern: '**/*.tsx' },
                { target: 'diff-text', pattern: 'tabIndex' },
            ],
        },
    };
    settings.roles['reviewer:accessibility'] = { model: other, effort: 'high' };
    settings.reviewers.find((entry) => entry.id === 'code')!.mode = { kind: 'never' };

    const result = resolveFactorySettings(settings, 'build', 'reviewer:accessibility');

    expect(result).toMatchObject({ model: other, effort: 'high' });
    expect(result.reviewers.map((entry) => entry.id)).not.toContain('code');
    expect(result.reviewers[0]).toEqual(custom);
    expect(resolveFactorySettings(settings, 'build', 'doubt').model).toBeNull();
    expect(resolveFactorySettings(settings, 'build', 'approver').model).toBeNull();
});

it('edits a built-in as append-only copies without mutating the original or its reference', () => {
    const original = defaultFactorySettings();
    const first = reviseReviewerInstructions(original, 'code', 'Check the contract.');
    const second = reviseReviewerInstructions(first, 'code', 'Check the contract and errors.');

    expect(reviewerInstructions(original.reviewers[0]!)).toHaveProperty('path');
    expect(second.reviewers[0]!.revisions).toEqual([
        { revision: 1, text: 'Check the contract.' },
        { revision: 2, text: 'Check the contract and errors.' },
    ]);
    expect(reviewerInstructions(second.reviewers[0]!)).toEqual({ revision: 2, text: 'Check the contract and errors.' });
    expect(() => reviseReviewerInstructions(first, 'missing', 'text')).toThrow('known reviewer');
});

describe('invalid settings are refused instead of silently changing the selected policy', () => {
    it.each([
        null,
        [],
        {},
        { version: 2 },
        { version: 1, roles: null },
        { version: 1, reviewers: null },
        { version: 1, threadKinds: null },
        { version: 1, threadKinds: { gate: {} } },
        { version: 1, roles: { fixer: {} } },
        { version: 1, roles: { 'reviewer:unknown': {} } },
        { version: 1, threadKinds: { build: { effort: '' } } },
        { version: 1, threadKinds: { build: { model: { instanceId: 'codex' } } } },
        { version: 1, threadKinds: { build: { effort: 3 } } },
    ])('refuses %j', (value) => expect(() => parseFactorySettings(value)).toThrow('Invalid factory settings'));
    it('refuses malformed, duplicate and unsafe reviewer definitions and unknown resolution inputs', () => {
        const defaults = defaultFactorySettings();
        const base = defaults.reviewers[0]!;

        for (const change of [
            { id: '../code' },
            { instructions: { kind: 'builtin', reviewer: 'security' } },
            { instructions: { kind: 'revision', revision: 2 } },
            { mode: { kind: 'on-trigger' } },
            { mode: { kind: 'on-trigger', trigger: { version: 2, kind: 'policy', policy: 'ui' } } },
            { revisions: [{ revision: 2, text: 'gap' }] },
        ]) {
            expect(() => parseFactorySettings({ ...defaults, reviewers: [{ ...base, ...change }] })).toThrow(
                'Invalid factory settings',
            );
        }
        expect(() => parseFactorySettings({ ...defaults, reviewers: [base, base] })).toThrow(
            'Invalid factory settings',
        );
        expect(() => resolveFactorySettings(defaults, 'gate' as never)).toThrow('Unknown thread kind');
        expect(() => resolveFactorySettings(defaults, 'build', 'unknown' as never)).toThrow('Unknown factory role');
    });
});
