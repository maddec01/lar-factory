import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { tempDir } from '../../test/stats-db.ts';
import { effectiveDefaults, findModelChoice, launchSelection, loadModelChoices } from './model-choices.ts';

const MANIFEST = {
    fetchedAtMs: 1,
    manifest: {
        currentModels: { codex: ['gpt-b', 'gpt-a'], claudeAgent: ['claude-opus', 'claude-new'], cursor: ['cursor-1'] },
        providers: {
            codex: {
                models: [
                    { slug: 'gpt-a', name: 'GPT A' },
                    { slug: 'gpt-b', name: 'GPT B' },
                ],
            },
            claudeAgent: {
                models: [
                    { slug: 'claude-opus', name: 'Claude Opus' },
                    { slug: 'claude-old', name: 'Claude Old' },
                ],
            },
            cursor: { models: [{ slug: 'cursor-1', name: 'Cursor 1' }] },
        },
    },
};

function files(t: TestContext, settings: unknown, manifest: unknown = MANIFEST) {
    const dir = tempDir(t, 'lar-model-choices-');
    const write = (name: string, value: unknown) => {
        writeFileSync(join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));

        return join(dir, name);
    };

    return { settings: write('settings.json', settings), manifest: write('model-manifest.json', manifest) };
}

const CODEX = {
    instanceId: 'codex',
    name: 'Codex · Default',
    models: [
        { slug: 'gpt-b', label: 'GPT B' },
        { slug: 'gpt-a', label: 'GPT A' },
    ],
};
const CLAUDE_MODELS = [
    { slug: 'claude-opus', label: 'Claude Opus' },
    { slug: 'claude-new', label: 'Claude New' },
];

test("offers each enabled instance's current models in manifest order, named, else by slug", (t) => {
    const { settings, manifest } = files(t, { providerInstances: {} });

    assert.deepEqual(loadModelChoices(settings, manifest), [
        CODEX,
        { instanceId: 'claudeAgent', name: 'Claude · Default', models: CLAUDE_MODELS },
    ]);
});

test('no other settings value leaves the option list', (t) => {
    const { settings, manifest } = files(t, {
        apiKey: 'SECRET-1',
        providerInstances: {
            claudeAgent: {
                driver: 'claudeAgent',
                displayName: 'VI',
                config: { homePath: 'SECRET-2', binaryPath: 'SECRET-3', launchArgs: ['SECRET-4'] },
            },
        },
    });
    const offered = JSON.stringify(loadModelChoices(settings, manifest));

    assert.doesNotMatch(offered, /SECRET/);
});

test('a choice is offered only as an enabled instance and one of its models', () => {
    const groups = [CODEX];

    assert.deepEqual(findModelChoice(groups, { instanceId: 'codex', model: 'gpt-a' }), {
        instanceId: 'codex',
        model: 'gpt-a',
    });
    for (const choice of [
        { instanceId: 'codex', model: 'gpt-z' },
        { instanceId: 'cursor', model: 'gpt-a' },
        { instanceId: 'codex' },
        { model: 'gpt-a' },
        { instanceId: 'codex', model: 'gpt-a', extra: 1 },
        'codex',
        null,
        [],
    ]) {
        assert.equal(findModelChoice(groups, choice), null, JSON.stringify(choice));
    }
});

const GLOBAL = {
    instanceId: 'codex',
    model: 'gpt-a',
    options: [
        { id: 'reasoningEffort', value: 'xhigh' },
        { id: 'serviceTier', value: 'default' },
    ],
};
const OVERRIDE = { instanceId: 'claudeAgent', model: 'claude-opus', options: [{ id: 'effort', value: 'medium' }] };
const noLegacy = () => {
    throw Error('folded settings never read the database');
};

test('the T3 Project default follows the project override when settings are folded, ignoring the project row', () => {
    const settings = {
        projectSettingsFolded: true,
        defaultModelSelection: GLOBAL,
        projectSettingsOverrides: { p: { defaultModelSelection: OVERRIDE } },
    };

    assert.deepEqual(effectiveDefaults(settings, 'p', noLegacy).selection, OVERRIDE);
    assert.deepEqual(effectiveDefaults(settings, 'other', noLegacy).selection, GLOBAL);
});

test("a choice takes the default's options only for the same instance and model", () => {
    const choice = { instanceId: OVERRIDE.instanceId, model: OVERRIDE.model };

    assert.deepEqual(launchSelection(choice, OVERRIDE), OVERRIDE);
    assert.deepEqual(launchSelection(choice, { ...choice }), choice);
    assert.deepEqual(launchSelection(choice, GLOBAL), choice);
    assert.deepEqual(launchSelection(choice, null), choice);
});
