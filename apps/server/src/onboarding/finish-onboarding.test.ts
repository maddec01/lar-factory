import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRepositoryList } from '../config/repository-config.ts';
import { finishOnboarding } from './finish-onboarding.ts';

const progress = { step: 'checks', done: ['project', 'setup'], answers: { projectId: 'lar-web' } };
const CONFIG = '{"role":"Web client","itemSource":{"kind":"issues"}}';

async function dataDir(t: TestContext, entries: object[] = []): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar finish onboarding test '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'repositories.json'), JSON.stringify({ repositories: entries }));
  return dir;
}

/** A gh that answers the repository's .lar-factory.json read with `file`, or a 404 when it's null. */
const gh = (file: string | null) => async () => {
  if (file === null) throw new Error('gh: Not Found (HTTP 404)');
  return file;
};

test('finishing a reused onboarding leaves its repository onboarded and returns the repositories still onboarding', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }, { repo: 'maddec01/lar-cli', onboarding: progress }]);
  assert.deepEqual(await finishOnboarding({ repo: 'maddec01/lar-web' }, dir, gh(CONFIG)), { onboarding: [{ repo: 'maddec01/lar-cli', progress }] });
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web' }, { repo: 'maddec01/lar-cli', onboarding: progress }]);
});

test('finishing reports the finished repository; a refused finish reports none', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }, { repo: 'maddec01/lar-cli', onboarding: progress }]);
  const finished: string[] = [];
  await finishOnboarding({ repo: 'maddec01/lar-cli' }, dir, gh(null), (repo) => finished.push(repo));
  await finishOnboarding({ repo: 'maddec01/lar-web' }, dir, gh(CONFIG), (repo) => finished.push(repo));
  assert.deepEqual(finished, ['maddec01/lar-web']);
});

test('a run never kept is added, in place of the one it was kept under before', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-apple', onboarding: progress }]);
  assert.deepEqual(await finishOnboarding({ repo: 'maddec01/lar-web', replaces: 'maddec01/lar-apple' }, dir, gh(CONFIG)), { onboarding: [] });
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web' }]);
});

test("a repository without a .lar-factory.json to reuse isn't finished", async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  assert.deepEqual(await finishOnboarding({ repo: 'maddec01/lar-web' }, dir, gh(null)),
    { status: 409, error: 'maddec01/lar-web has no .lar-factory.json on its default branch to reuse.' });
  assert.deepEqual(await finishOnboarding({ repo: 'maddec01/lar-web' }, dir, gh('{"itemSource":{"kind":"issues"}}')),
    { status: 409, error: '.lar-factory.json field role is missing or not a string.' });
  assert.deepEqual(await finishOnboarding({ repo: 'maddec01/lar-web' }, dir, async () => { throw new Error('HTTP 502'); }),
    { status: 502, error: "Can't read maddec01/lar-web's .lar-factory.json: HTTP 502" });
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web', onboarding: progress }]);
});

test('a body without a repository is a 400; one onboarded already is a 409', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web' }]);
  for (const body of [{}, { repo: 'lar-web' }, { repo: 'maddec01/lar-web', replaces: 3 }]) {
    assert.deepEqual(await finishOnboarding(body, dir, gh(CONFIG)), { status: 400, error: 'Send the repository whose onboarding finishes.' }, JSON.stringify(body));
  }
  assert.deepEqual(await finishOnboarding({ repo: 'maddec01/lar-web' }, dir, gh(CONFIG)), { status: 409, error: 'maddec01/lar-web is onboarded already.' });
});
