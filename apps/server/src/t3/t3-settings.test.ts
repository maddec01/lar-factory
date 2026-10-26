import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeFileSync } from 'node:fs';
import { environmentIdPath, readEnvironmentId, readT3Settings, serverRuntimePath, statsDbPath, t3Running, t3SettingsPath, usageRatesPath } from './t3-settings.ts';
import { t3Settings, tempDir } from '../../test/stats-db.ts';

test('T3\'s files are under its userdata folder unless the environment names them', () => {
  const env = { HOME: '/Users/me' };
  assert.equal(statsDbPath(env), '/Users/me/.t3/userdata/statev2.sqlite');
  assert.equal(t3SettingsPath(env), '/Users/me/.t3/userdata/settings.json');
  assert.equal(usageRatesPath({ ...env, T3_STATE_DB: '/tmp/t3/state.sqlite' }), '/tmp/t3/usage-model-rates.json');
  assert.equal(environmentIdPath(env), '/Users/me/.t3/userdata/environment-id');
  assert.equal(environmentIdPath({ ...env, T3_ENVIRONMENT_ID: '/tmp/t3/env' }), '/tmp/t3/env');
  assert.equal(serverRuntimePath(env), '/Users/me/.t3/userdata/server-runtime.json');
  assert.equal(serverRuntimePath({ ...env, T3_SERVER_RUNTIME: '/tmp/t3/runtime.json' }), '/tmp/t3/runtime.json');
});

test('T3 Code runs while its runtime file names a live process', (t) => {
  const dir = tempDir(t, 'lar-t3-runtime-');
  const runtime = (name: string, text: string) => {
    writeFileSync(join(dir, name), text);
    return join(dir, name);
  };
  const state = (pid: unknown) => JSON.stringify({ version: 1, pid, port: 3773, origin: 'http://127.0.0.1:3773', startedAt: '2026-10-25T09:04:46.754Z' });
  assert.equal(t3Running(runtime('live', state(process.pid))), true);
  // pid 1 belongs to root: signalling it fails with EPERM, which still means it runs.
  assert.equal(t3Running(runtime('root', state(1))), true);
  assert.equal(t3Running(join(dir, 'missing')), false, 'T3 removes the file when it stops');
  assert.equal(t3Running(runtime('blank', '\n')), false);
  assert.equal(t3Running(runtime('garbled', '{"pid":')), false);
  assert.equal(t3Running(runtime('no-pid', state('15454'))), false);
  // A pid past the system's largest belongs to no process, as after a crash that left the file.
  assert.equal(t3Running(runtime('stale', state(2 ** 30))), false);
});

test('T3\'s environment id is the file\'s trimmed text, absent when the file is missing or blank', (t) => {
  const dir = tempDir(t, 'lar-t3-env-');
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
