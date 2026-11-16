import { expect, test } from 'vite-plus/test';

import { parseFactorySettings } from './factory-settings-parse.ts';
import { reviewerInstructions } from './factory-settings-resolve.ts';

const revisions = [
    { revision: 1, text: 'First saved edit.' },
    { revision: 2, text: 'Second saved edit.' },
];
const mode = {
    kind: 'on-trigger',
    trigger: { version: 1, kind: 'rules', any: [{ target: 'path-glob', pattern: 'src/**' }] },
};

test('migrates active packaged edits without losing history, trigger, selected revision or role choices', () => {
    const legacy = {
        version: 1,
        roles: { 'reviewer:security': { effort: 'high' } },
        reviewers: [
            { id: 'security', name: 'Security', mode, instructions: { kind: 'revision', revision: 1 }, revisions },
        ],
    };
    const settings = parseFactorySettings(legacy);
    const builtin = settings.reviewers.find((entry) => entry.id === 'security')!;
    const copy = settings.reviewers.find((entry) => entry.id === 'custom-security-copy')!;

    expect(settings.version).toBe(2);
    expect(builtin.mode).toEqual({ kind: 'never' });
    expect(builtin).not.toHaveProperty('revisions');
    expect(reviewerInstructions(builtin)).toEqual({ path: 'skills/lar-build/agents/reviewer-security.md' });
    expect(copy).toMatchObject({
        name: 'Security (copy)',
        mode,
        revisions,
        instructions: { kind: 'revision', revision: 1 },
    });
    expect(reviewerInstructions(copy)).toEqual(revisions[0]);
    expect(settings.roles['reviewer:custom-security-copy']).toEqual({ effort: 'high' });
    expect(parseFactorySettings(settings)).toEqual(settings);
    expect(parseFactorySettings(legacy)).toEqual(settings);
    expect(legacy.reviewers[0]!.revisions).toHaveLength(2);
});

test('retains restored instruction history as a disabled copy and avoids existing custom IDs', () => {
    const settings = parseFactorySettings({
        version: 1,
        reviewers: [
            {
                id: 'code',
                name: 'Code',
                mode: { kind: 'always' },
                instructions: { kind: 'builtin', reviewer: 'code' },
                revisions,
            },
            {
                id: 'custom-code-copy',
                name: 'Existing',
                instructions: { kind: 'revision', revision: 1 },
                revisions: [revisions[0]],
            },
        ],
    });

    expect(settings.reviewers.find((entry) => entry.id === 'code')?.mode.kind).toBe('always');
    expect(settings.reviewers.find((entry) => entry.id === 'custom-code-copy-2')).toMatchObject({
        mode: { kind: 'never' },
        revisions,
        instructions: { kind: 'revision', revision: 2 },
    });
    expect(settings.reviewers.find((entry) => entry.id === 'custom-code-copy')?.name).toBe('Existing');
});
