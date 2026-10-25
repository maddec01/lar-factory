import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findModelChoice, loadModelChoices } from './model-choices.ts';
import { modelManifestPath } from './t3-settings.ts';
import { tempDir } from '../../test/stats-db.ts';

const MANIFEST = {
  fetchedAtMs: 1,
  manifest: {
    currentModels: { codex: ['gpt-b', 'gpt-a'], claudeAgent: ['claude-opus', 'claude-new'], cursor: ['cursor-1'] },
    providers: {
      codex: { models: [{ slug: 'gpt-a', name: 'GPT A' }, { slug: 'gpt-b', name: 'GPT B' }] },
      claudeAgent: { models: [{ slug: 'claude-opus', name: 'Claude Opus' }, { slug: 'claude-old', name: 'Claude Old' }] },
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

const CODEX = { instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-b', label: 'GPT B' }, { slug: 'gpt-a', label: 'GPT A' }] };
const CLAUDE_MODELS = [{ slug: 'claude-opus', label: 'Claude Opus' }, { slug: 'claude-new', label: 'claude-new' }];

test("offers each enabled instance's current models in manifest order, named, else by slug", (t) => {
  const { settings, manifest } = files(t, { providerInstances: {} });
  assert.deepEqual(loadModelChoices(settings, manifest), [
    CODEX,
    { instanceId: 'claudeAgent', name: 'Claude', models: CLAUDE_MODELS },
  ]);
});

test("enabled instances follow T3's rules; disabled ones aren't offered", (t) => {
  const { settings, manifest } = files(t, { providerInstances: {
    claudeAgent_personal: { driver: 'claudeAgent', displayName: 'Personal', enabled: true },
    claudeAgent: { driver: 'claudeAgent', displayName: 'VI', enabled: true },
    codex_off: { driver: 'codex', enabled: false },
    codex_config_off: { driver: 'codex', config: { enabled: false } },
    cursor: { driver: 'cursor', displayName: 'Cursor' },
    cursor_on: { driver: 'cursor', enabled: true },
    codex_work: { driver: 'codex', displayName: 'Codex' },
  } });
  assert.deepEqual(loadModelChoices(settings, manifest).map((g) => [g.instanceId, g.name]), [
    ['claudeAgent_personal', 'Personal'],
    ['claudeAgent', 'VI'],
    ['cursor_on', 'Cursor On'],
    // A name equal to the driver's falls back to the id, as T3's picker shows it.
    ['codex_work', 'Codex Work'],
    ['codex', 'Codex'],
  ]);
});

test("an instance's custom models follow its current models, by slug", (t) => {
  const { settings, manifest } = files(t, { providerInstances: {
    codex: { driver: 'codex', config: { customModels: ['gpt-custom', { slug: 'gpt-entry', name: 'Entry' }, 'gpt-a', ' ', 7] } },
    claudeAgent: { driver: 'claudeAgent', enabled: false },
  } });
  assert.deepEqual(loadModelChoices(settings, manifest), [{ ...CODEX, models: [...CODEX.models,
    { slug: 'gpt-custom', label: 'gpt-custom' }, { slug: 'gpt-entry', label: 'gpt-entry' }] }]);
});

test('an instance with no models is left out', (t) => {
  const { settings, manifest } = files(t, { providerInstances: { grok: { driver: 'grok', enabled: true } } });
  assert.deepEqual(loadModelChoices(settings, manifest).map((g) => g.instanceId), ['codex', 'claudeAgent']);
});

for (const [name, settingsValue, manifestValue] of [
  ['unreadable settings', '{ broken', MANIFEST],
  ['settings that are not an object', '[]', MANIFEST],
  ['an unreadable manifest', { providerInstances: {} }, '{ broken'],
  ['a manifest with no current models', { providerInstances: {} }, { manifest: {} }],
] as const) {
  test(`${name} offer only T3 default`, (t) => {
    const { settings, manifest } = files(t, settingsValue, manifestValue);
    assert.deepEqual(loadModelChoices(settings, manifest), []);
  });
}

test('missing files offer only T3 default', (t) => {
  const dir = tempDir(t, 'lar-model-choices-');
  assert.deepEqual(loadModelChoices(join(dir, 'none.json'), join(dir, 'none.json')), []);
});

test('no other settings value leaves the option list', (t) => {
  const { settings, manifest } = files(t, { apiKey: 'SECRET-1', providerInstances: {
    claudeAgent: { driver: 'claudeAgent', displayName: 'VI', config: { homePath: 'SECRET-2', binaryPath: 'SECRET-3', launchArgs: ['SECRET-4'] } },
  } });
  const offered = JSON.stringify(loadModelChoices(settings, manifest));
  assert.doesNotMatch(offered, /SECRET/);
});

test('a choice is offered only as an enabled instance and one of its models', () => {
  const groups = [CODEX];
  assert.deepEqual(findModelChoice(groups, { instanceId: 'codex', model: 'gpt-a' }), { instanceId: 'codex', model: 'gpt-a' });
  for (const choice of [{ instanceId: 'codex', model: 'gpt-z' }, { instanceId: 'cursor', model: 'gpt-a' },
    { instanceId: 'codex' }, { model: 'gpt-a' }, { instanceId: 'codex', model: 'gpt-a', extra: 1 }, 'codex', null, []]) {
    assert.equal(findModelChoice(groups, choice), null, JSON.stringify(choice));
  }
});

test('T3_MODEL_MANIFEST overrides where the manifest is read, else it sits beside the settings', () => {
  assert.equal(modelManifestPath({ T3_MODEL_MANIFEST: '/x/m.json', HOME: '/h' }), '/x/m.json');
  assert.equal(modelManifestPath({ HOME: '/h' }), '/h/.t3/userdata/model-manifest.json');
  assert.equal(modelManifestPath({ T3_SETTINGS: '/s/settings.json', HOME: '/h' }), '/s/model-manifest.json');
});
