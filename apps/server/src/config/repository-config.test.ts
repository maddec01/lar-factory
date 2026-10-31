import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeAzRepos } from '../azure/fake-az.ts';
import {
  dropRepository, findRepositoryConfig, isItemSource, isRepo, readBoardSettings, readRepositoryList, saveOnboarded,
  saveOnboarding, savePrClosed, saveResetting, stillOnboarding,
} from './repository-config.ts';

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

const progress = (step = 'setup', projectId = 'lar-apple') => ({ step, done: ['project'], answers: { projectId } });
const setup = { itemSource: 'issues', show: 'all', showPicked: false, role: 'Apple app' };
const cleanup = { ticks: { context: true, scratch: false }, skills: { '.claude/skills/code-review/': { kind: 'rename', name: 'web-review' }, '.agents/skills/tdd/': { kind: 'delete' } } };

test('the list file names the onboarded repositories, each still onboarding with its progress; a missing one names none', async (t) => {
  const onboarding = { ...progress(), answers: { projectId: 'lar-apple', provider: 'GitHub', setup, cleanup, customLabels: ['app: music'] }, prUrl: 'https://github.com/maddec01/lar-apple/pull/4' };
  const list = { repositories: [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', onboarding }] };
  assert.deepEqual(readRepositoryList(await dataDir(t, { 'repository-settings.json': JSON.stringify(list) })),
    [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', onboarding }]);
  assert.deepEqual(readRepositoryList(await dataDir(t)), []);
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
    { step: 'setup', done: 'project', answers: { projectId: 'x' } }, { ...progress(), answers: {} }, { ...progress(), prUrl: 4 }, { ...progress(), prClosed: false },
    ...[{ itemSource: 'sprint' }, { show: 'some' }, { role: 3 }, { showPicked: 'yes' }, { team: 3 }].map((wrong) =>
      ({ ...progress(), answers: { projectId: 'x', setup: { ...setup, ...wrong } } })), { ...progress(), answers: { projectId: 'x', provider: 'GitLab' } },
    { ...progress(), answers: { projectId: 'x', customLabels: 'app: music' } },
    ...[{ ticks: [] }, { ticks: { context: 'yes' } }, { skills: { tdd: { kind: 'keep' } } }, { skills: { tdd: { kind: 'rename' } } }].map((wrong) =>
      ({ ...progress(), answers: { projectId: 'x', cleanup: { ...cleanup, ...wrong } } }))]) {
    const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple', onboarding }] }) });
    assert.throws(() => readRepositoryList(dir), { message: `${join(dir, 'repository-settings.json')}: repositories[0] has an onboarding without its step, done steps and T3 project, or with answers it can't use.` },
      JSON.stringify(onboarding));
  }
});

const RESET_PR = 'https://github.com/maddec01/lar-apple/pull/9';

test('a resetting entry holds its reset PR, and one without a PR URL is refused, naming its entry', async (t) => {
  const list = { repositories: [{ repo: 'maddec01/lar-apple', resetting: { prUrl: RESET_PR } }] };
  assert.deepEqual(readRepositoryList(await dataDir(t, { 'repository-settings.json': JSON.stringify(list) })), [{ repo: 'maddec01/lar-apple', resetting: { prUrl: RESET_PR } }]);
  for (const resetting of [true, {}, { prUrl: 4 }]) {
    const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple', resetting }] }) });
    assert.throws(() => readRepositoryList(dir), { message: `${join(dir, 'repository-settings.json')}: repositories[0] has a resetting without its PR's URL.` });
  }
  const both = await dataDir(t, { 'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple', onboarding: progress(), resetting: { prUrl: RESET_PR } }] }) });
  assert.throws(() => readRepositoryList(both), { message: `${join(both, 'repository-settings.json')}: repositories[0] is both onboarding and resetting.` });
});

test("resetting an onboarded repository keeps its reset PR in its entry, whatever the case, and keeps every other entry and the file's other keys", async (t) => {
  const list = { note: 'kept', repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' }, { repo: 'maddec01/lar-apple' }] };
  const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify(list) });
  assert.deepEqual(saveResetting('MADDEC01/Lar-Apple', RESET_PR, dir), [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', resetting: { prUrl: RESET_PR } }]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'repository-settings.json'), 'utf8')),
    { note: 'kept', repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' }, { repo: 'maddec01/lar-apple', resetting: { prUrl: RESET_PR } }] });
});

test('only an onboarded repository can be resetting', async (t) => {
  const list = { repositories: [{ repo: 'maddec01/lar-apple', onboarding: progress() }, { repo: 'maddec01/lar-web', resetting: { prUrl: RESET_PR } }] };
  const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify(list) });
  assert.throws(() => saveResetting('maddec01/lar-apple', RESET_PR, dir), { message: 'maddec01/lar-apple is not onboarded.' });
  assert.throws(() => saveResetting('maddec01/lar-web', RESET_PR, dir), { message: 'maddec01/lar-web is not onboarded.' });
  assert.throws(() => saveResetting('maddec01/lar-docs', RESET_PR, dir), { message: 'maddec01/lar-docs is not onboarded.' });
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

test("the board marks an onboarding's PR closed; a save with the same PR keeps the mark, and one with another PR drops it", async (t) => {
  const PR = 'https://github.com/maddec01/lar-apple/pull/4';
  const open = { ...progress('pr'), prUrl: PR };
  const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple', onboarding: open }] }) });
  assert.deepEqual(savePrClosed('maddec01/lar-apple', true, dir), [{ repo: 'maddec01/lar-apple', onboarding: { ...open, prClosed: true } }]);
  assert.deepEqual(saveOnboarding({ repo: 'maddec01/lar-apple', progress: open }, null, dir), [{ repo: 'maddec01/lar-apple', onboarding: { ...open, prClosed: true } }]);
  assert.deepEqual(savePrClosed('maddec01/lar-apple', false, dir), [{ repo: 'maddec01/lar-apple', onboarding: open }]);
  savePrClosed('maddec01/lar-apple', true, dir);
  const next = { ...open, prUrl: 'https://github.com/maddec01/lar-apple/pull/5' };
  assert.deepEqual(saveOnboarding({ repo: 'maddec01/lar-apple', progress: { ...next, prClosed: true } }, null, dir), [{ repo: 'maddec01/lar-apple', onboarding: next }]);
  assert.throws(() => savePrClosed('maddec01/lar-web', true, dir), { message: 'maddec01/lar-web is not onboarding.' });
});

test("the board marks a PR that keeps the .lar-factory.json; a save with the same PR keeps the mark, and one with another PR drops it", async (t) => {
  const open = { ...progress('pr'), prUrl: 'https://github.com/maddec01/lar-apple/pull/4' };
  const dir = await dataDir(t);
  assert.deepEqual(saveOnboarding({ repo: 'maddec01/lar-apple', progress: open }, null, dir, { reusesConfig: true }),
    [{ repo: 'maddec01/lar-apple', onboarding: { ...open, reusesConfig: true } }]);
  assert.deepEqual(saveOnboarding({ repo: 'maddec01/lar-apple', progress: open }, null, dir), [{ repo: 'maddec01/lar-apple', onboarding: { ...open, reusesConfig: true } }]);
  const next = { ...open, prUrl: 'https://github.com/maddec01/lar-apple/pull/5' };
  assert.deepEqual(saveOnboarding({ repo: 'maddec01/lar-apple', progress: { ...next, reusesConfig: true } }, null, dir), [{ repo: 'maddec01/lar-apple', onboarding: next }]);
});

test("the repositories still onboarding carry the problem following each one's PR met on this refresh, whatever the case", () => {
  const waiting = { ...progress('pr'), prUrl: 'https://github.com/maddec01/lar-apple/pull/4' };
  const list = [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', onboarding: waiting }, { repo: 'maddec01/lar-docs', onboarding: progress() }];
  assert.deepEqual(stillOnboarding(list, new Map([['MADDEC01/Lar-Apple', 'gh pr view failed: HTTP 502']])),
    [{ repo: 'maddec01/lar-apple', progress: waiting, followProblem: 'gh pr view failed: HTTP 502' }, { repo: 'maddec01/lar-docs', progress: progress() }]);
  assert.deepEqual(stillOnboarding(list), [{ repo: 'maddec01/lar-apple', progress: waiting }, { repo: 'maddec01/lar-docs', progress: progress() }]);
  assert.deepEqual(stillOnboarding([...list, { repo: 'maddec01/lar-web', resetting: { prUrl: RESET_PR } }]), stillOnboarding(list));
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

test("dropping a repository removes its entry, whatever the case, and keeps every other entry and the file's other keys as the file has them", async (t) => {
  const dir = await dataDir(t, { 'repository-settings.json': JSON.stringify({ note: 'kept', repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' },
    { repo: 'maddec01/lar-apple', onboarding: progress() }, { repo: 'maddec01/lar-cli', onboarding: progress('checks') }] }) });
  assert.deepEqual(dropRepository('MADDEC01/Lar-Apple', dir), [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-cli', onboarding: progress('checks') }]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'repository-settings.json'), 'utf8')),
    { note: 'kept', repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' }, { repo: 'maddec01/lar-cli', onboarding: progress('checks') }] });
  assert.throws(() => dropRepository('maddec01/lar-apple', dir), { message: "maddec01/lar-apple is not on this Mac's list." });
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

test('the settings file sets the refresh interval; a missing file or field takes 300 seconds', async (t) => {
  assert.deepEqual(readBoardSettings(await dataDir(t, { 'settings.json': '{ "refreshSeconds": 30 }' })), { refreshSeconds: 30 });
  assert.deepEqual(readBoardSettings(await dataDir(t, { 'settings.json': '{}' })), { refreshSeconds: 300 });
  assert.deepEqual(readBoardSettings(await dataDir(t)), { refreshSeconds: 300 });
});

test("a settings file that isn't JSON, or whose refresh interval isn't a positive number, takes the default, naming its path and the problem", async (t) => {
  const broken = await dataDir(t, { 'settings.json': '{ broken' });
  assert.deepEqual(readBoardSettings(broken), { refreshSeconds: 300, problem: `${join(broken, 'settings.json')} isn't valid JSON.` });
  for (const text of ['[]', '{ "refreshSeconds": "30" }', '{ "refreshSeconds": 0 }']) {
    const dir = await dataDir(t, { 'settings.json': text });
    assert.deepEqual(readBoardSettings(dir),
      { refreshSeconds: 300, problem: `${join(dir, 'settings.json')}: expected an object with a positive refreshSeconds, like {"refreshSeconds": 300}.` }, text);
  }
});

test("a repository's config comes from its default branch, with each missing field taking its default", async () => {
  const project = { kind: 'issues' };
  const gh = ghWith({ 'maddec01/lar-factory': { version: 1, role: 'The factory', itemSource: project, show: 'opted-in', labels: ['area'] },
    'maddec01/lar-apple': { role: 'Apple client' } });
  assert.deepEqual(await findRepositoryConfig('maddec01/lar-factory', gh),
    { repo: 'maddec01/lar-factory', version: 1, role: 'The factory', itemSource: project, show: 'opted-in', labels: ['area'] });
  assert.deepEqual(await findRepositoryConfig('maddec01/lar-apple', gh),
    { repo: 'maddec01/lar-apple', version: 1, role: 'Apple client', itemSource: { kind: 'issues' }, show: 'all', labels: [] });
});

test("an Azure DevOps repository's config is read from its default branch with one az call, and a missing file is no config", async () => {
  const file = { role: 'API', itemSource: { kind: 'azure-board', team: 'Fabrikam Team' }, show: 'opted-in' };
  const az = fakeAzRepos({ files: { '/.lar-factory.json': JSON.stringify(file) } });
  assert.deepEqual(await findRepositoryConfig('contoso/Fabrikam%20Fiber/lar-api', az.run),
    { repo: 'contoso/Fabrikam%20Fiber/lar-api', version: 1, role: 'API', itemSource: file.itemSource, show: 'opted-in', labels: [] });
  assert.deepEqual(az.calls, [['devops', 'invoke', '--area', 'git', '--resource', 'items', '--route-parameters', 'project=Fabrikam Fiber', 'repositoryId=lar-api',
    '--query-parameters', 'path=/.lar-factory.json', 'includeContent=true', '--api-version', '7.1', '--org', 'https://dev.azure.com/contoso', '--detect', 'false', '--output', 'json']]);
  assert.equal(await findRepositoryConfig('contoso/Fabrikam%20Fiber/lar-api', fakeAzRepos().run), null);
  const loggedOut = fakeAzRepos({ fail: () => new Error('az devops invoke failed: Please run az login to setup account.') });
  await assert.rejects(findRepositoryConfig('contoso/Fabrikam%20Fiber/lar-api', loggedOut.run), /az login/);
});

test('a gh failure other than a 404 passes through', async () => {
  const gh = async () => { throw new Error('gh api failed: To get started with GitHub CLI, please run:  gh auth login'); };
  await assert.rejects(findRepositoryConfig('maddec01/lar-factory', gh), /gh auth login/);
});

test('only issues and a combined Azure board are item sources', () => {
  assert.equal(isItemSource({ kind: 'issues' }), true);
  assert.equal(isItemSource({ kind: 'azure-board', team: 'Team' }), true);
  for (const source of [null, {}, { kind: 'azure-board' }, { kind: 'azure-board', team: '' }, { kind: 'unknown' }]) assert.equal(isItemSource(source), false);
});

test('removed and unknown sources ask for onboarding again, without migration', async () => {
  for (const kind of ['github-project', 'azure-sprint', 'azure-backlog', 'unknown']) {
    for (const repo of ['maddec01/lar-factory', 'contoso/Fabrikam/api']) {
      const raw = JSON.stringify({ role: 'API', itemSource: { kind, owner: 'maddec01', number: 1, team: 'Team' } });
      const run = async () => repo.split('/').length === 3 ? JSON.stringify({ content: raw }) : raw;
      assert.deepEqual(await findRepositoryConfig(repo, run), { problem: '.lar-factory.json has an unsupported item source. Run onboarding again.' });
    }
  }
});

test('malformed configs still name their problem', async () => {
  const gh = ghWith({ 'maddec01/broken': '{ broken', 'maddec01/no-role': {}, 'maddec01/some': { role: 'x', show: 'some' } });
  assert.equal(await findRepositoryConfig('maddec01/missing', gh), null);
  for (const [repo, problem] of Object.entries({ broken: ".lar-factory.json isn't valid JSON.",
    'no-role': '.lar-factory.json field role is missing or not a string.', some: '.lar-factory.json field show must be "all" or "opted-in".' })) {
    assert.deepEqual(await findRepositoryConfig(`maddec01/${repo}`, gh), { problem });
  }
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
