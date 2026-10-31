import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_VERSION } from '@lar-factory/shared';
import { configUpdateOf, dismissConfigUpdate, readDismissedUpdates } from './config-update.ts';

/** The list of a data folder where both repositories are onboarded. */
const LIST = JSON.stringify({ repositories: [{ repo: 'maddec01/lar-web' }, { repo: 'maddec01/lar-api' }] });

async function dataDir(t: TestContext, files: Record<string, string> = { 'repository-settings.json': LIST }): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar config update test '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

test('the app writes Repository config version 1, so a file at version 1 gets no notice', () => {
  assert.equal(CONFIG_VERSION, 1);
  assert.equal(configUpdateOf({ repo: 'maddec01/lar-web', version: 1 }, new Map()), undefined);
});

test('a file below the app version gets the notice at the app version, one at or above it none', () => {
  assert.equal(configUpdateOf({ repo: 'maddec01/lar-web', version: 1 }, new Map(), 2), 2);
  assert.equal(configUpdateOf({ repo: 'maddec01/lar-web', version: 2 }, new Map(), 2), undefined);
  assert.equal(configUpdateOf({ repo: 'maddec01/lar-web', version: 3 }, new Map(), 2), undefined);
});

test('a notice dismissed at the app version stays gone, and one dismissed at an older app version comes back', () => {
  assert.equal(configUpdateOf({ repo: 'maddec01/lar-web', version: 1 }, new Map([['Maddec01/Lar-Web', 2]]), 2), undefined);
  assert.equal(configUpdateOf({ repo: 'maddec01/lar-web', version: 1 }, new Map([['maddec01/lar-web', 2]]), 3), 3);
  assert.equal(configUpdateOf({ repo: 'maddec01/lar-web', version: 1 }, new Map([['maddec01/lar-api', 2]]), 2), 2);
});

test('a dismissal is kept in the data folder by repository and app version, keeping the others, so it survives a restart', async (t) => {
  const dir = await dataDir(t, { 'repository-settings.json': LIST, 'config-update-notices.json': JSON.stringify({ dismissed: { 'maddec01/lar-api': 2 } }) });
  assert.equal(dismissConfigUpdate('maddec01/lar-web', 3, dir), null);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'config-update-notices.json'), 'utf8')), { dismissed: { 'maddec01/lar-api': 2, 'maddec01/lar-web': 3 } });
  assert.deepEqual(readDismissedUpdates(dir), new Map([['maddec01/lar-api', 2], ['maddec01/lar-web', 3]]));
});

test('dismissing again under another case replaces the entry; a missing or unusable file dismisses nothing', async (t) => {
  const dir = await dataDir(t);
  assert.deepEqual(readDismissedUpdates(dir), new Map());
  dismissConfigUpdate('maddec01/lar-web', 2, dir);
  dismissConfigUpdate('Maddec01/lar-web', 3, dir);
  assert.deepEqual(readDismissedUpdates(dir), new Map([['Maddec01/lar-web', 3]]));
  assert.deepEqual(readDismissedUpdates(await dataDir(t, { 'config-update-notices.json': '{"dismissed": {"maddec01/lar-web": "2"}' })), new Map());
  assert.deepEqual(readDismissedUpdates(await dataDir(t, { 'config-update-notices.json': '{"dismissed": {"maddec01/lar-web": "2"}}' })), new Map());
});

test('a repository that is not onboarded is refused as Edit refuses it, and nothing is recorded', async (t) => {
  const progress = { step: 'checks', done: ['project', 'setup'], answers: { projectId: 'lar-web' } };
  const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-web', onboarding: progress }] }) });
  assert.deepEqual(dismissConfigUpdate('maddec01/lar-web', 2, dir), { status: 409, error: 'maddec01/lar-web is still onboarding.' });
  assert.deepEqual(dismissConfigUpdate('maddec01/lar-cli', 2, dir), { status: 409, error: "maddec01/lar-cli is not on this Mac's list." });
  assert.deepEqual(readDismissedUpdates(dir), new Map());
});
