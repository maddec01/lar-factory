import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveOnboarded } from '../config/repository-config.ts';
import { keepOnboarding } from './keep-onboarding.ts';

const progress = { step: 'setup', done: ['project'], answers: { projectId: 'lar-web' } };

async function dataDir(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar keep onboarding test '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('keeping an onboarding returns the repositories still onboarding, the one it replaces gone', async (t) => {
  const dir = await dataDir(t);
  assert.deepEqual(await keepOnboarding({ repo: 'maddec01/lar-apple', progress }, dir), { onboarding: [{ repo: 'maddec01/lar-apple', progress }] });
  assert.deepEqual(await keepOnboarding({ repo: 'maddec01/lar-web', progress, replaces: 'maddec01/lar-apple' }, dir),
    { onboarding: [{ repo: 'maddec01/lar-web', progress }] });
});

test('a body without a repository of the form owner/name and progress is a 400; a repository the list refuses is a 409 with why', async (t) => {
  const dir = await dataDir(t);
  for (const body of [{ progress }, { repo: 'maddec01/lar-web' }, { repo: 'maddec01/lar-web', progress, replaces: 3 }]) {
    assert.deepEqual(await keepOnboarding(body, dir), { status: 400, error: 'Send the repository and where its onboarding stopped.' }, JSON.stringify(body));
  }
  assert.deepEqual(await keepOnboarding({ repo: 'lar-web', progress }, dir), { status: 400, error: 'Send the repository and where its onboarding stopped.' });
  saveOnboarded('maddec01/lar-web', null, dir);
  assert.deepEqual(await keepOnboarding({ repo: 'maddec01/lar-web', progress }, dir), { status: 409, error: 'maddec01/lar-web is onboarded already.' });
});

test('only the step, done steps and answers of the body\'s progress are saved', async (t) => {
  const dir = await dataDir(t);
  assert.deepEqual(await keepOnboarding({ repo: 'maddec01/lar-web', progress: { ...progress, prUrl: 'https://evil.example/pull/1' } }, dir),
    { onboarding: [{ repo: 'maddec01/lar-web', progress }] });
});
