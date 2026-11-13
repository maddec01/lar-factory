import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { tempDir } from '../../test/stats-db.ts';
import { effectiveDefaults, findModelChoice, launchSelection, loadModelChoices } from './model-choices.ts';
import { modelManifestPath } from './t3-settings.ts';

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

test("enabled instances follow T3's rules; disabled ones aren't offered", (t) => {
    const { settings, manifest } = files(t, {
        providerInstances: {
            claudeAgent_personal: { driver: 'claudeAgent', displayName: 'Personal', enabled: true },
            claudeAgent: { driver: 'claudeAgent', displayName: 'VI', enabled: true },
            codex_off: { driver: 'codex', enabled: false },
            codex_config_off: { driver: 'codex', config: { enabled: false } },
            cursor: { driver: 'cursor', displayName: 'Cursor' },
            cursor_on: { driver: 'cursor', enabled: true },
            codex_work: { driver: 'codex', displayName: 'Codex' },
        },
    });

    assert.deepEqual(
        loadModelChoices(settings, manifest).map((g) => [g.instanceId, g.name]),
        [
            ['claudeAgent_personal', 'Claude · Personal'],
            ['claudeAgent', 'Claude · VI'],
            ['cursor_on', 'Cursor · On'],
            // A name equal to the driver's falls back to the id, as T3's picker shows it.
            ['codex_work', 'Codex · Work'],
            ['codex', 'Codex · Default'],
        ],
    );
});

test("an instance's custom models follow its current models, by slug", (t) => {
    const { settings, manifest } = files(t, {
        providerInstances: {
            codex: {
                driver: 'codex',
                config: { customModels: ['gpt-custom', { slug: 'gpt-entry', name: 'Entry' }, 'gpt-a', ' ', 7] },
            },
            claudeAgent: { driver: 'claudeAgent', enabled: false },
        },
    });

    assert.deepEqual(loadModelChoices(settings, manifest), [
        {
            ...CODEX,
            models: [
                ...CODEX.models,
                { slug: 'gpt-custom', label: 'GPT Custom' },
                { slug: 'gpt-entry', label: 'Entry' },
            ],
        },
    ]);
});

test('an instance with no models is left out', (t) => {
    const { settings, manifest } = files(t, { providerInstances: { grok: { driver: 'grok', enabled: true } } });

    assert.deepEqual(
        loadModelChoices(settings, manifest).map((g) => g.instanceId),
        ['codex', 'claudeAgent'],
    );
});

for (const [name, settingsValue, manifestValue] of [
    ['unreadable settings', '{ broken', MANIFEST],
    ['settings that are not an object', '[]', MANIFEST],
    ['an unreadable manifest', { providerInstances: {} }, '{ broken'],
    ['a manifest with no current models', { providerInstances: {} }, { manifest: {} }],
] as const) {
    test(`${name} offer only T3 Project default`, (t) => {
        const { settings, manifest } = files(t, settingsValue, manifestValue);

        assert.deepEqual(loadModelChoices(settings, manifest), []);
    });
}

test('missing files offer only T3 Project default', (t) => {
    const dir = tempDir(t, 'lar-model-choices-');

    assert.deepEqual(loadModelChoices(join(dir, 'none.json'), join(dir, 'none.json')), []);
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

test('T3_MODEL_MANIFEST overrides where the manifest is read, else it sits beside the settings', () => {
    assert.equal(modelManifestPath({ T3_MODEL_MANIFEST: '/x/m.json', HOME: '/h' }), '/x/m.json');
    assert.equal(modelManifestPath({ HOME: '/h' }), '/h/.t3/userdata/model-manifest.json');
    assert.equal(modelManifestPath({ T3_SETTINGS: '/s/settings.json', HOME: '/h' }), '/s/model-manifest.json');
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
const LEGACY = { instanceId: 'codex', model: 'gpt-b' };
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

test('before folding, the project row applies under its stored override', () => {
    const base = { defaultModelSelection: GLOBAL, projectSettingsOverrides: {} };

    assert.deepEqual(effectiveDefaults(base, 'p', () => LEGACY).selection, LEGACY);
    assert.deepEqual(effectiveDefaults(base, 'p', () => null).selection, GLOBAL);
    assert.deepEqual(
        effectiveDefaults(
            { ...base, projectSettingsOverrides: { p: { defaultModelSelection: OVERRIDE } } },
            'p',
            () => LEGACY,
        ).selection,
        OVERRIDE,
    );
});

test('an unread project row leaves the T3 Project default unknown, so no options are copied', () => {
    const answer = effectiveDefaults({ defaultModelSelection: GLOBAL }, 'p', () => {
        throw Error('no database');
    });

    assert.equal(answer.selection, null);
});

test('a project override on a disabled instance falls back to the global default', () => {
    const folded = { projectSettingsFolded: true, defaultModelSelection: GLOBAL };
    const off = {
        ...folded,
        providerInstances: { claudeAgent: { driver: 'claudeAgent', enabled: false } },
        projectSettingsOverrides: { p: { defaultModelSelection: OVERRIDE } },
    };

    assert.deepEqual(effectiveDefaults(off, 'p', noLegacy).selection, GLOBAL);

    const onHere = {
        ...off,
        projectSettingsOverrides: {
            p: { defaultModelSelection: OVERRIDE, providerInstances: { claudeAgent: { enabled: true } } },
        },
    };

    assert.deepEqual(effectiveDefaults(onHere, 'p', noLegacy).selection, OVERRIDE);

    const unlisted = {
        ...folded,
        projectSettingsOverrides: { p: { defaultModelSelection: { instanceId: 'gone', model: 'm' } } },
    };

    assert.deepEqual(effectiveDefaults(unlisted, 'p', noLegacy).selection, GLOBAL);
});

test('only instance, model and option ids and values leave the settings', () => {
    const settings = {
        projectSettingsFolded: true,
        defaultModelSelection: {
            ...OVERRIDE,
            secret: 'x',
            options: [{ id: 'effort', value: 'medium', secret: 'y' }, { id: 'bad', value: {} }, 'junk'],
        },
    };

    assert.deepEqual(effectiveDefaults(settings, 'p', noLegacy).selection, OVERRIDE);
});

test("the runtime mode follows the project override, then the global setting, then T3's own default", () => {
    const folded = { projectSettingsFolded: true };

    assert.equal(effectiveDefaults(folded, 'p', noLegacy).runtimeMode, 'full-access');
    assert.equal(effectiveDefaults({ ...folded, defaultRuntimeMode: 'auto' }, 'p', noLegacy).runtimeMode, 'auto');
    assert.equal(
        effectiveDefaults(
            {
                ...folded,
                defaultRuntimeMode: 'auto',
                projectSettingsOverrides: { p: { defaultRuntimeMode: 'approval-required' } },
            },
            'p',
            noLegacy,
        ).runtimeMode,
        'approval-required',
    );
});

test("a choice takes the default's options only for the same instance and model", () => {
    const choice = { instanceId: OVERRIDE.instanceId, model: OVERRIDE.model };

    assert.deepEqual(launchSelection(choice, OVERRIDE), OVERRIDE);
    assert.deepEqual(launchSelection(choice, { ...choice }), choice);
    assert.deepEqual(launchSelection(choice, GLOBAL), choice);
    assert.deepEqual(launchSelection(choice, null), choice);
});

test('merges aliases, honours custom display names and labels context variants', (t) => {
    const manifestData = structuredClone(MANIFEST);
    const model = manifestData.manifest.providers.claudeAgent.models[0]!;

    Object.assign(model, { slug: 'claude-opus-5-5', name: 'Claude Opus 5.5', aliases: ['opus'] });
    manifestData.manifest.currentModels.claudeAgent = ['claude-opus-5-5'];

    const { settings, manifest } = files(
        t,
        {
            providerInstances: {
                codex: { driver: 'codex', enabled: false },
                claudeAgent: {
                    driver: 'claudeAgent',
                    displayName: 'Personal',
                    config: { customModels: ['opus', 'opus[1m]', { slug: 'custom', name: 'Research model' }] },
                },
            },
        },
        manifestData,
    );

    assert.deepEqual(loadModelChoices(settings, manifest), [
        {
            instanceId: 'claudeAgent',
            name: 'Claude · Personal',
            models: [
                { slug: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
                { slug: 'claude-opus-5-5[1m]', label: 'Claude Opus 5.5 · 1M context' },
                { slug: 'custom', label: 'Research model' },
            ],
        },
    ]);
});

test('offers effort IDs and labels from a model or its manifest profile, without other capabilities', (t) => {
    const manifest = structuredClone(MANIFEST);

    Object.assign(manifest.manifest.providers.codex, {
        profiles: {
            reasoning: {
                capabilities: {
                    optionDescriptors: [
                        {
                            id: 'reasoningEffort',
                            type: 'select',
                            options: [{ id: 'high', label: 'High', secret: 'hidden' }],
                        },
                    ],
                },
            },
        },
    });
    Object.assign(manifest.manifest.providers.codex.models[0]!, { profile: 'reasoning' });

    const { settings, manifest: file } = files(t, { providerInstances: {} }, manifest);

    assert.deepEqual(loadModelChoices(settings, file)[0]!.models[1], {
        slug: 'gpt-a',
        label: 'GPT A',
        efforts: [{ value: 'high', label: 'High' }],
    });
});
