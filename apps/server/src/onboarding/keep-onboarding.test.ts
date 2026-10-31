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
  assert.deepEqual(await keepOnboarding({ repo: 'maddec01/lar-web', progress }, dir, async () => '{"role":"API"}'), { status: 409, error: 'maddec01/lar-web is onboarded already.' });
});

test('only the step, done steps and answers of the body\'s progress are saved', async (t) => {
  const dir = await dataDir(t);
  assert.deepEqual(await keepOnboarding({ repo: 'maddec01/lar-web', progress: { ...progress, prUrl: 'https://evil.example/pull/1' } }, dir),
    { onboarding: [{ repo: 'maddec01/lar-web', progress }] });
});

test('fresh onboarding can replace listed settings that cannot be used', async (t) => {
  const dir = await dataDir(t);
  saveOnboarded('maddec01/lar-web', null, dir);
  const run = async () => '{"role":"API","itemSource":{"kind":"github-project"}}';
  assert.deepEqual(await keepOnboarding({ repo: 'maddec01/lar-web', progress }, dir, run), { onboarding: [{ repo: 'maddec01/lar-web', progress }] });
});

test('recovery keeps healthy repositories and refuses a settings read failure', async (t) => {
  const dir = await dataDir(t);
  saveOnboarded('maddec01/broken', null, dir);
  saveOnboarded('maddec01/healthy', null, dir);
  const { readRepositoryList } = await import('../config/repository-config.ts');
  const before = readRepositoryList(dir);
  const input = { repo: 'maddec01/broken', progress };
  assert.deepEqual(await keepOnboarding(input, dir, async () => { throw new Error('Sign in first'); }), { status: 409, error: 'Sign in first' });
  assert.deepEqual(await keepOnboarding({ ...input, replaces: 'maddec01/healthy' }, dir, async () => '{broken'), { status: 409, error: 'maddec01/healthy is onboarded already.' });
  assert.deepEqual(readRepositoryList(dir), before);
});
