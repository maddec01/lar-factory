import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readBoardSettings, readRepositoryConfig, readRepositoryList } from './repository-config.ts';

async function dataDir(t: TestContext, files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar repository config test '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

/** A gh that answers the contents call for each repository in `files`, and 404s for any other. */
function ghWith(files: Record<string, unknown>): (args: string[]) => Promise<string> {
  return async (args) => {
    const repo = /^repos\/([^/]+\/[^/]+)\/contents\/\.lar-factory\.json$/.exec(args[1] ?? '')?.[1];
    assert.ok(args.includes('Accept: application/vnd.github.raw') && !args.some((a) => a.includes('ref')), args.join(' '));
    if (!repo || !(repo in files)) throw new Error(`gh api ${args[1]} failed: gh: Not Found (HTTP 404)`);
    const file = files[repo];
    return typeof file === 'string' ? file : JSON.stringify(file);
  };
}

test('the list file names the onboarded repositories; a missing one names none', async (t) => {
  const list = { repositories: [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', onboarding: true }] };
  assert.deepEqual(readRepositoryList(await dataDir(t, { 'repositories.json': JSON.stringify(list) })),
    [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple' }]);
  assert.deepEqual(readRepositoryList(await dataDir(t)), []);
});

test("a list file that isn't JSON or has the wrong shape is refused, naming its path and the problem", async (t) => {
  const broken = await dataDir(t, { 'repositories.json': '{ broken' });
  assert.throws(() => readRepositoryList(broken), { message: `${join(broken, 'repositories.json')} isn't valid JSON.` });
  for (const shape of [[], { repositories: {} }, { repositories: ['maddec01/lar-factory'] }, { repositories: [{ repo: 'lar-factory' }] },
    { repositories: [{ repo: 'maddec01/..' }] }, { repositories: [{ repo: '../lar-factory' }] }, { repositories: [{ repo: 'maddec01/lar?x' }] },
    { repositories: [{ repo: 'maddec01/lar#x' }] }]) {
    const dir = await dataDir(t, { 'repositories.json': JSON.stringify(shape) });
    assert.throws(() => readRepositoryList(dir), (err: Error) => err.message.startsWith(`${join(dir, 'repositories.json')}: `), JSON.stringify(shape));
  }
});

test('the settings file sets the refresh interval; a missing file or field takes 45 seconds', async (t) => {
  assert.deepEqual(readBoardSettings(await dataDir(t, { 'settings.json': '{ "refreshSeconds": 30 }' })), { refreshSeconds: 30 });
  assert.deepEqual(readBoardSettings(await dataDir(t, { 'settings.json': '{}' })), { refreshSeconds: 45 });
  assert.deepEqual(readBoardSettings(await dataDir(t)), { refreshSeconds: 45 });
});

test("a settings file that isn't JSON, or whose refresh interval isn't a positive number, takes the default, naming its path and the problem", async (t) => {
  const broken = await dataDir(t, { 'settings.json': '{ broken' });
  assert.deepEqual(readBoardSettings(broken), { refreshSeconds: 45, problem: `${join(broken, 'settings.json')} isn't valid JSON.` });
  for (const text of ['[]', '{ "refreshSeconds": "30" }', '{ "refreshSeconds": 0 }']) {
    const dir = await dataDir(t, { 'settings.json': text });
    assert.deepEqual(readBoardSettings(dir),
      { refreshSeconds: 45, problem: `${join(dir, 'settings.json')}: expected an object with a positive refreshSeconds, like {"refreshSeconds": 45}.` }, text);
  }
});

test("a repository's config comes from its default branch, with each missing field taking its default", async () => {
  const project = { kind: 'github-project', owner: 'maddec01', number: 1 };
  const gh = ghWith({ 'maddec01/lar-factory': { version: 1, role: 'The factory', itemSource: project, show: 'opted-in', labels: ['area'] },
    'maddec01/lar-apple': { role: 'Apple client' } });
  assert.deepEqual(await readRepositoryConfig('maddec01/lar-factory', gh),
    { repo: 'maddec01/lar-factory', version: 1, role: 'The factory', itemSource: project, show: 'opted-in', labels: ['area'] });
  assert.deepEqual(await readRepositoryConfig('maddec01/lar-apple', gh),
    { repo: 'maddec01/lar-apple', version: 1, role: 'Apple client', itemSource: { kind: 'issues' }, show: 'all', labels: [] });
});

test("a repository without the file, or with a file that doesn't parse or has a wrong field, is refused, naming it", async () => {
  const gh = ghWith({ 'maddec01/broken': '{ broken', 'maddec01/no-role': {}, 'maddec01/sprint': { role: 'x', itemSource: { kind: 'sprint' } },
    'maddec01/no-number': { role: 'x', itemSource: { kind: 'github-project', owner: 'maddec01' } }, 'maddec01/some': { role: 'x', show: 'some' },
    'maddec01/bad-owner': { role: 'x', itemSource: { kind: 'github-project', owner: 'lar" or true or "', number: 3 } },
    'maddec01/bad-number': { role: 'x', itemSource: { kind: 'github-project', owner: 'maddec01', number: 1.5 } } });
  const refusals = {
    'maddec01/missing': 'maddec01/missing: no .lar-factory.json on its default branch.',
    'maddec01/broken': "maddec01/broken: .lar-factory.json isn't valid JSON.",
    'maddec01/no-role': 'maddec01/no-role: .lar-factory.json field role is missing or not a string.',
    'maddec01/sprint': 'maddec01/sprint: .lar-factory.json field itemSource.kind must be "issues" or "github-project".',
    'maddec01/no-number': 'maddec01/no-number: .lar-factory.json field itemSource.number must be a positive whole number for a github-project.',
    'maddec01/bad-number': 'maddec01/bad-number: .lar-factory.json field itemSource.number must be a positive whole number for a github-project.',
    'maddec01/bad-owner': 'maddec01/bad-owner: .lar-factory.json field itemSource.owner must be a GitHub login for a github-project.',
    'maddec01/some': 'maddec01/some: .lar-factory.json field show must be "all" or "opted-in".',
  };
  for (const [repo, message] of Object.entries(refusals)) await assert.rejects(readRepositoryConfig(repo, gh), { message });
});

test('a gh failure other than a 404 passes through', async () => {
  const gh = async () => { throw new Error('gh api failed: To get started with GitHub CLI, please run:  gh auth login'); };
  await assert.rejects(readRepositoryConfig('maddec01/lar-factory', gh), /gh auth login/);
});
