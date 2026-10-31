import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  isItemSource, isRepo, readBoardSettings, readRepositoryList, saveOnboarded,
  saveOnboarding, stillOnboarding,
} from './repository-config.ts';

async function dataDir(t: TestContext, files: Record<string, string> = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar repository config test '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
  return dir;
}

const progress = (step = 'setup', projectId = 'lar-apple') => ({ step, done: ['project'], answers: { projectId } });
const setup = { itemSource: 'issues', role: 'Apple app' };

test('the list file names the onboarded repositories, each still onboarding with its progress; a missing one names none', async (t) => {
  const onboarding = { ...progress(), answers: { projectId: 'lar-apple', provider: 'GitHub', setup } };
  const list = { repositories: [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', onboarding }] };
  assert.deepEqual(readRepositoryList(await dataDir(t, { 'repository-settings.json': JSON.stringify(list) })),
    [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', onboarding }]);
  assert.deepEqual(readRepositoryList(await dataDir(t)), []);
});

test('progress saved with the old show setting still resumes', async (t) => {
  const onboarding = { ...progress(), answers: { projectId: 'lar-apple', setup: { ...setup, show: 'some', showPicked: 'yes' } } };
  const list = { repositories: [{ repo: 'maddec01/lar-apple', onboarding }] };
  assert.deepEqual(readRepositoryList(await dataDir(t, { 'repository-settings.json': JSON.stringify(list) })), [{ repo: 'maddec01/lar-apple', onboarding }]);
});

test("an onboarding's setup answers may name an Azure DevOps team's sprint or backlog", async (t) => {
  for (const itemSource of ['azure-board']) {
    const onboarding = { ...progress(), answers: { projectId: 'lar-api', provider: 'Azure DevOps', setup: { ...setup, itemSource, team: 'Fabrikam Team' } } };
    const list = { repositories: [{ repo: 'contoso/Fabrikam/lar-api', onboarding }] };
    assert.deepEqual(readRepositoryList(await dataDir(t, { 'repository-settings.json': JSON.stringify(list) })), [{ repo: 'contoso/Fabrikam/lar-api', onboarding }]);
  }
});

test("an onboarding that isn't progress is refused, naming its entry", async (t) => {
  for (const onboarding of [true, { step: 'setup', done: ['project'] }, { step: 3, done: [], answers: { projectId: 'x' } },
    { step: 'setup', done: 'project', answers: { projectId: 'x' } }, { ...progress(), answers: {} },
    ...[{ itemSource: 'sprint' }, { role: 3 }, { team: 3 }].map((wrong) =>
      ({ ...progress(), answers: { projectId: 'x', setup: { ...setup, ...wrong } } })), { ...progress(), answers: { projectId: 'x', provider: 'GitLab' } }]) {
    const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple', onboarding }] }) });
    assert.throws(() => readRepositoryList(dir), { message: `${join(dir, 'repository-settings.json')}: repositories[0] has an onboarding without its step, done steps and T3 project, or with answers it can't use.` },
      JSON.stringify(onboarding));
  }
});

test('saving an onboarding adds its repository to the list, or updates its entry, and keeps the other entries as they are', async (t) => {
  const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' }] }) });
  const file = join(dir, 'repository-settings.json');
  assert.deepEqual(saveOnboarding({ repo: 'maddec01/lar-apple', progress: progress() }, null, dir),
    [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', onboarding: progress() }]);
  saveOnboarding({ repo: 'maddec01/Lar-Apple', progress: progress('checks') }, null, dir);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')),
    { repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' }, { repo: 'maddec01/Lar-Apple', onboarding: progress('checks') }] });
});

test('saving an onboarding that picked another project replaces the entry it was saved under', async (t) => {
  const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple', onboarding: progress() }] }) });
  assert.deepEqual(saveOnboarding({ repo: 'maddec01/lar-web', progress: progress('setup', 'lar-web') }, 'maddec01/lar-apple', dir),
    [{ repo: 'maddec01/lar-web', onboarding: progress('setup', 'lar-web') }]);
});

test("the list starts empty in its own file, leaving the old repositories.json and settings.json as they are", async (t) => {
  const old = { 'repositories.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-factory' }] }), 'settings.json': '{ "refreshSeconds": 30 }' };
  const dir = await dataDir(t, old);
  assert.deepEqual(readRepositoryList(dir), []);
  saveOnboarding({ repo: 'maddec01/lar-apple', progress: progress() }, null, dir);
  saveOnboarded('maddec01/lar-apple', null, dir);
  for (const [name, text] of Object.entries(old)) assert.equal(await readFile(join(dir, name), 'utf8'), text, name);
  // A later launch reads the same new list.
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-apple' }]);
});

test('saving an onboarding makes the list file and its folder when there are none', async (t) => {
  const dir = join(await dataDir(t), 'Lar Factory');
  saveOnboarding({ repo: 'maddec01/lar-apple', progress: progress() }, null, dir);
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-apple', onboarding: progress() }]);
});

test('the repositories still onboarding are those with progress', () => {
  const list = [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-docs', onboarding: progress() }];
  assert.deepEqual(stillOnboarding(list), [{ repo: 'maddec01/lar-docs', progress: progress() }]);
});

test('finishing an onboarding leaves its entry with the repository alone, in place of the entry it was saved under', async (t) => {
  const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-factory' },
    { repo: 'maddec01/lar-apple', onboarding: progress() }, { repo: 'maddec01/lar-cli', onboarding: progress() }] }) });
  assert.deepEqual(saveOnboarded('maddec01/lar-apple', null, dir),
    [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple' }, { repo: 'maddec01/lar-cli', onboarding: progress() }]);
  assert.deepEqual(saveOnboarded('maddec01/lar-web', 'maddec01/lar-cli', dir),
    [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple' }, { repo: 'maddec01/lar-web' }]);
  assert.throws(() => saveOnboarded('maddec01/lar-apple', null, dir), { message: 'maddec01/lar-apple is onboarded already.' });
});

test('saving an onboarding for a repository that is onboarded already, or into a list that can\'t be read, is refused', async (t) => {
  const onboarded = await dataDir(t, { 'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple' }] }) });
  assert.throws(() => saveOnboarding({ repo: 'maddec01/lar-apple', progress: progress() }, null, onboarded), { message: 'maddec01/lar-apple is onboarded already.' });
  assert.throws(() => saveOnboarding({ repo: 'maddec01/lar-web', progress: progress() }, 'maddec01/lar-apple', onboarded), { message: 'maddec01/lar-apple is onboarded already.' });
  const broken = await dataDir(t, { 'repository-settings.json': '{ broken' });
  assert.throws(() => saveOnboarding({ repo: 'maddec01/lar-apple', progress: progress() }, null, broken), { message: `${join(broken, 'repository-settings.json')} isn't valid JSON.` });
});

test("a list file that isn't JSON or has the wrong shape is refused, naming its path and the problem", async (t) => {
  const broken = await dataDir(t, { 'repository-settings.json': '{ broken' });
  assert.throws(() => readRepositoryList(broken), { message: `${join(broken, 'repository-settings.json')} isn't valid JSON.` });
  for (const shape of [[], { repositories: {} }, { repositories: ['maddec01/lar-factory'] }, { repositories: [{ repo: 'lar-factory' }] },
    { repositories: [{ repo: 'maddec01/..' }] }, { repositories: [{ repo: '../lar-factory' }] }, { repositories: [{ repo: 'maddec01/lar?x' }] },
    { repositories: [{ repo: 'maddec01/lar#x' }] }, { repositories: [{ repo: 'contoso/Fabrikam/lar-api/x' }] },
    { repositories: [{ repo: 'contoso/../lar-api' }] }, { repositories: [{ repo: 'contoso/Fabrikam/..' }] }]) {
    const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify(shape) });
    assert.throws(() => readRepositoryList(dir), (err: Error) => err.message.startsWith(`${join(dir, 'repository-settings.json')}: `), JSON.stringify(shape));
  }
});

test('a repository is owner/name on GitHub or organization/project/repository on Azure DevOps, as its origin URL has them', async (t) => {
  for (const repo of ['maddec01/lar-factory', 'contoso/Fabrikam/lar-api', 'contoso/Fabrikam%20Fiber/lar~api']) assert.equal(isRepo(repo), true, repo);
  for (const repo of ['maddec01/lar factory', 'contoso/Fabrikam Fiber/lar-api', 'contoso/Fabrikam/lar-api/x', 'contoso/../lar-api', 'contoso/Fabrikam/.']) {
    assert.equal(isRepo(repo), false, repo);
  }
  const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'contoso/Fabrikam%20Fiber/lar-api' }] }) });
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'contoso/Fabrikam%20Fiber/lar-api' }]);
});

test("the repository list file sets the refresh interval, and the old settings.json doesn't; a missing file or field takes 300 seconds", async (t) => {
  const list = (extra: object) => ({ 'repository-settings.json': JSON.stringify({ repositories: [], ...extra }) });
  assert.deepEqual(readBoardSettings(await dataDir(t, list({ refreshSeconds: 30 }))), { refreshSeconds: 30 });
  assert.deepEqual(readBoardSettings(await dataDir(t, list({}))), { refreshSeconds: 300 });
  assert.deepEqual(readBoardSettings(await dataDir(t, { 'settings.json': '{ "refreshSeconds": 30 }' })), { refreshSeconds: 300 });
  assert.deepEqual(readBoardSettings(await dataDir(t)), { refreshSeconds: 300 });
});

test("a list file that isn't JSON, or whose refresh interval isn't a positive number, takes the default, naming its path and the problem", async (t) => {
  const broken = await dataDir(t, { 'repository-settings.json': '{ broken' });
  assert.deepEqual(readBoardSettings(broken), { refreshSeconds: 300, problem: `${join(broken, 'repository-settings.json')} isn't valid JSON.` });
  for (const text of ['[]', '{ "refreshSeconds": "30" }', '{ "refreshSeconds": 0 }']) {
    const dir = await dataDir(t, { 'repository-settings.json': text });
    assert.deepEqual(readBoardSettings(dir),
      { refreshSeconds: 300, problem: `${join(dir, 'repository-settings.json')}: expected an object with a positive refreshSeconds, like {"refreshSeconds": 300}.` }, text);
  }
});

test('only issues and a combined Azure board are item sources', () => {
  assert.equal(isItemSource({ kind: 'issues' }), true);
  assert.equal(isItemSource({ kind: 'azure-board', team: 'Team' }), true);
  for (const source of [null, {}, { kind: 'azure-board' }, { kind: 'azure-board', team: '' }, { kind: 'unknown' }]) assert.equal(isItemSource(source), false);
});

test('removed-source onboarding entries do not break healthy repositories or later saves', async (t) => {
  const entries = ['github-project', 'azure-sprint', 'azure-backlog'].map((itemSource, index) => ({ repo: `maddec01/old-${index}`,
    onboarding: { ...progress(), answers: { projectId: 'old', setup: { ...setup, itemSource } } } }));
  const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify({ note: 'keep', repositories: [
    { repo: 'maddec01/healthy', note: 'keep' }, ...entries, { repo: 'maddec01/current', onboarding: progress() },
  ] }) });
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/healthy' }, { repo: 'maddec01/current', onboarding: progress() }]);
  saveOnboarding({ repo: 'maddec01/new', progress: progress() }, null, dir);
  const saved = JSON.parse(await readFile(join(dir, 'repository-settings.json'), 'utf8'));
  assert.equal(saved.note, 'keep');
  assert.deepEqual(saved.repositories.map((entry: { repo: string }) => entry.repo), ['maddec01/healthy', 'maddec01/current', 'maddec01/new']);
  assert.equal(saved.repositories[0].note, 'keep');
});
