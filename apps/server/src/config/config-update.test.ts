import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_VERSION } from '@lar-factory/shared';
import { configUpdateOf, dismissConfigUpdate } from './config-update.ts';
import { readDismissedUpdates } from './repository-settings.ts';

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

test("a dismissal is kept in the repository's local settings by app version, so it survives a restart, and old files stay as they are", async (t) => {
  const old = JSON.stringify({ dismissed: { 'maddec01/lar-api': 2 } });
  const dir = await dataDir(t, { 'repository-settings.json': LIST, 'config-update-notices.json': old });
  assert.equal(dismissConfigUpdate('maddec01/lar-web', 3, dir), null);
  assert.equal(await readFile(join(dir, 'config-update-notices.json'), 'utf8'), old);
  const file = JSON.parse(await readFile(join(dir, 'repository-settings.json'), 'utf8'));
  assert.equal(file.repositories[0].settings.dismissedUpdate, 3);
  assert.deepEqual(readDismissedUpdates(dir), new Map([['maddec01/lar-web', 3]]));
});

test('dismissing again replaces the version; a repository never dismissed has none', async (t) => {
  const dir = await dataDir(t);
  assert.deepEqual(readDismissedUpdates(dir), new Map());
  dismissConfigUpdate('maddec01/lar-web', 2, dir);
  dismissConfigUpdate('Maddec01/lar-web', 3, dir);
  assert.deepEqual(readDismissedUpdates(dir), new Map([['maddec01/lar-web', 3]]));
});

test('a repository that is not onboarded is refused as Edit refuses it, and nothing is recorded', async (t) => {
  const progress = { step: 'checks', done: ['project', 'setup'], answers: { projectId: 'lar-web' } };
  const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-web', onboarding: progress }] }) });
  assert.deepEqual(dismissConfigUpdate('maddec01/lar-web', 2, dir), { status: 409, error: 'maddec01/lar-web is still onboarding.' });
  assert.deepEqual(dismissConfigUpdate('maddec01/lar-cli', 2, dir), { status: 409, error: "maddec01/lar-cli is not on this Mac's list." });
  assert.deepEqual(readDismissedUpdates(dir), new Map());
});
