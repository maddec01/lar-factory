import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync } from 'node:fs';
import { environmentIdPath, readEnvironmentId, readT3Settings, statsDbPath, t3SettingsPath, usageRatesPath } from './t3-settings.ts';
import { t3Settings, tempDir } from '../../test/stats-db.ts';

test('T3\'s files are under its userdata folder unless the environment names them', () => {
  const env = { HOME: '/Users/pedro' };
  assert.equal(statsDbPath(env), '/Users/pedro/.t3/userdata/statev2.sqlite');
  assert.equal(t3SettingsPath(env), '/Users/pedro/.t3/userdata/settings.json');
  assert.equal(usageRatesPath({ ...env, T3_STATE_DB: '/tmp/t3/state.sqlite' }), '/tmp/t3/usage-model-rates.json');
  assert.equal(environmentIdPath(env), '/Users/pedro/.t3/userdata/environment-id');
  assert.equal(environmentIdPath({ ...env, T3_ENVIRONMENT_ID: '/tmp/t3/env' }), '/tmp/t3/env');
});

test('T3\'s environment id is the file\'s trimmed text, absent when the file is missing or blank', (t) => {
  const dir = tempDir(t, 'mux-t3-env-');
  writeFileSync(join(dir, 'environment-id'), '5e3c-8c5a\n');
  writeFileSync(join(dir, 'blank'), ' \n');
  assert.equal(readEnvironmentId(join(dir, 'environment-id')), '5e3c-8c5a');
  assert.equal(readEnvironmentId(join(dir, 'blank')), undefined);
  assert.equal(readEnvironmentId(join(dir, 'missing')), undefined);
});

test('settings that can\'t be read leave the built-in instances at their usual homes, with no prices or aliases', () => {
  assert.deepEqual(readT3Settings(join(tmpdir(), 'no-such-dir', 'settings.json'), '/home'), {
    instanceHomes: new Map([['claudeAgent', { driver: 'claudeAgent', home: '/home/.claude' }], ['codex', { driver: 'codex', home: '/home/.codex' }]]),
    priceOverrides: {},
    modelAliases: {},
  });
});

test('an instance\'s homePath expands `~`, other drivers are left out, and only valid prices and aliases are kept', (t) => {
  const path = t3Settings(t, { work: '~/work-claude', box: { driver: 'codex', homePath: '/box/codex' }, cursor: { driver: 'cursor', homePath: '/c' } }, {
    usagePriceOverrides: { ' m ': { inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 2 }, bad: { inputCostPerMillionTokens: -1, outputCostPerMillionTokens: 2 } },
    usageModelAliases: { ' a ': ' b ', empty: ' ' },
  });
  const settings = readT3Settings(path, '/home');
  assert.deepEqual(settings.instanceHomes.get('work'), { driver: 'claudeAgent', home: '/home/work-claude' });
  assert.deepEqual(settings.instanceHomes.get('box'), { driver: 'codex', home: '/box/codex' });
  assert.equal(settings.instanceHomes.has('cursor'), false);
  assert.deepEqual(settings.priceOverrides, { m: { inputCostPerMillionTokens: 1, outputCostPerMillionTokens: 2 } });
  assert.deepEqual(settings.modelAliases, { a: 'b' });
});
