import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dropRepository, readBoardSettings, readOnboardedConfigs, readRepositoryConfig, readRepositoryList, saveOnboarded, saveOnboarding, savePrClosed, saveResetting,
  stillOnboarding,
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
const setup = { itemSource: 'github-project', projectOwner: 'maddec01', projectNumber: '3', show: 'all', showPicked: false, role: 'Apple app' };
const cleanup = { ticks: { context: true, scratch: false }, skills: { '.claude/skills/code-review/': { kind: 'rename', name: 'web-review' }, '.agents/skills/tdd/': { kind: 'delete' } } };

test('the list file names the onboarded repositories, each still onboarding with its progress; a missing one names none', async (t) => {
  const onboarding = { ...progress(), answers: { projectId: 'lar-apple', provider: 'GitHub', setup, cleanup, customLabels: ['app: music'] }, prUrl: 'https://github.com/maddec01/lar-apple/pull/4' };
  const list = { repositories: [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', onboarding }] };
  assert.deepEqual(readRepositoryList(await dataDir(t, { 'repositories.json': JSON.stringify(list) })),
    [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', onboarding }]);
  assert.deepEqual(readRepositoryList(await dataDir(t)), []);
});

test("an onboarding that isn't progress is refused, naming its entry", async (t) => {
  for (const onboarding of [true, { step: 'setup', done: ['project'] }, { step: 3, done: [], answers: { projectId: 'x' } },
    { step: 'setup', done: 'project', answers: { projectId: 'x' } }, { ...progress(), answers: {} }, { ...progress(), prUrl: 4 }, { ...progress(), prClosed: false },
    ...[{ itemSource: 'sprint' }, { show: 'some' }, { role: 3 }, { projectNumber: 3 }, { showPicked: 'yes' }].map((wrong) =>
      ({ ...progress(), answers: { projectId: 'x', setup: { ...setup, ...wrong } } })), { ...progress(), answers: { projectId: 'x', provider: 'GitLab' } },
    { ...progress(), answers: { projectId: 'x', customLabels: 'app: music' } },
    ...[{ ticks: [] }, { ticks: { context: 'yes' } }, { skills: { tdd: { kind: 'keep' } } }, { skills: { tdd: { kind: 'rename' } } }].map((wrong) =>
      ({ ...progress(), answers: { projectId: 'x', cleanup: { ...cleanup, ...wrong } } }))]) {
    const dir = await dataDir(t, { 'repositories.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple', onboarding }] }) });
    assert.throws(() => readRepositoryList(dir), { message: `${join(dir, 'repositories.json')}: repositories[0] has an onboarding without its step, done steps and T3 project, or with answers it can't use.` },
      JSON.stringify(onboarding));
  }
});

const RESET_PR = 'https://github.com/maddec01/lar-apple/pull/9';

test('a resetting entry holds its reset PR, and one without a PR URL is refused, naming its entry', async (t) => {
  const list = { repositories: [{ repo: 'maddec01/lar-apple', resetting: { prUrl: RESET_PR } }] };
  assert.deepEqual(readRepositoryList(await dataDir(t, { 'repositories.json': JSON.stringify(list) })), [{ repo: 'maddec01/lar-apple', resetting: { prUrl: RESET_PR } }]);
  for (const resetting of [true, {}, { prUrl: 4 }]) {
    const dir = await dataDir(t, { 'repositories.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple', resetting }] }) });
    assert.throws(() => readRepositoryList(dir), { message: `${join(dir, 'repositories.json')}: repositories[0] has a resetting without its PR's URL.` });
  }
  const both = await dataDir(t, { 'repositories.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple', onboarding: progress(), resetting: { prUrl: RESET_PR } }] }) });
  assert.throws(() => readRepositoryList(both), { message: `${join(both, 'repositories.json')}: repositories[0] is both onboarding and resetting.` });
});

test("resetting an onboarded repository keeps its reset PR in its entry, whatever the case, and keeps every other entry and the file's other keys", async (t) => {
  const list = { note: 'kept', repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' }, { repo: 'maddec01/lar-apple' }] };
  const dir = await dataDir(t, { 'repositories.json': JSON.stringify(list) });
  assert.deepEqual(saveResetting('MADDEC01/Lar-Apple', RESET_PR, dir), [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', resetting: { prUrl: RESET_PR } }]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'repositories.json'), 'utf8')),
    { note: 'kept', repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' }, { repo: 'maddec01/lar-apple', resetting: { prUrl: RESET_PR } }] });
});

test('only an onboarded repository can be resetting', async (t) => {
  const list = { repositories: [{ repo: 'maddec01/lar-apple', onboarding: progress() }, { repo: 'maddec01/lar-web', resetting: { prUrl: RESET_PR } }] };
  const dir = await dataDir(t, { 'repositories.json': JSON.stringify(list) });
  assert.throws(() => saveResetting('maddec01/lar-apple', RESET_PR, dir), { message: 'maddec01/lar-apple is not onboarded.' });
  assert.throws(() => saveResetting('maddec01/lar-web', RESET_PR, dir), { message: 'maddec01/lar-web is not onboarded.' });
  assert.throws(() => saveResetting('maddec01/lar-docs', RESET_PR, dir), { message: 'maddec01/lar-docs is not onboarded.' });
});

test('saving an onboarding adds its repository to the list, or updates its entry, and keeps the other entries as they are', async (t) => {
  const dir = await dataDir(t, { 'repositories.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' }] }) });
  const file = join(dir, 'repositories.json');
  assert.deepEqual(saveOnboarding({ repo: 'maddec01/lar-apple', progress: progress() }, null, dir),
    [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', onboarding: progress() }]);
  saveOnboarding({ repo: 'maddec01/Lar-Apple', progress: progress('checks') }, null, dir);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')),
    { repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' }, { repo: 'maddec01/Lar-Apple', onboarding: progress('checks') }] });
});

test('saving an onboarding that picked another project replaces the entry it was saved under', async (t) => {
  const dir = await dataDir(t, { 'repositories.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple', onboarding: progress() }] }) });
  assert.deepEqual(saveOnboarding({ repo: 'maddec01/lar-web', progress: progress('setup', 'lar-web') }, 'maddec01/lar-apple', dir),
    [{ repo: 'maddec01/lar-web', onboarding: progress('setup', 'lar-web') }]);
});

test('saving an onboarding makes the list file and its folder when there are none', async (t) => {
  const dir = join(await dataDir(t), 'Lar Factory');
  saveOnboarding({ repo: 'maddec01/lar-apple', progress: progress() }, null, dir);
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-apple', onboarding: progress() }]);
});

test("the board marks an onboarding's PR closed; a save with the same PR keeps the mark, and one with another PR drops it", async (t) => {
  const PR = 'https://github.com/maddec01/lar-apple/pull/4';
  const open = { ...progress('pr'), prUrl: PR };
  const dir = await dataDir(t, { 'repositories.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple', onboarding: open }] }) });
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
  const dir = await dataDir(t, { 'repositories.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-factory' },
    { repo: 'maddec01/lar-apple', onboarding: progress() }, { repo: 'maddec01/lar-cli', onboarding: progress() }] }) });
  assert.deepEqual(saveOnboarded('maddec01/lar-apple', null, dir),
    [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple' }, { repo: 'maddec01/lar-cli', onboarding: progress() }]);
  assert.deepEqual(saveOnboarded('maddec01/lar-web', 'maddec01/lar-cli', dir),
    [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple' }, { repo: 'maddec01/lar-web' }]);
  assert.throws(() => saveOnboarded('maddec01/lar-apple', null, dir), { message: 'maddec01/lar-apple is onboarded already.' });
});

test("dropping a repository removes its entry, whatever the case, and keeps every other entry and the file's other keys as the file has them", async (t) => {
  const dir = await dataDir(t, { 'repositories.json': JSON.stringify({ note: 'kept', repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' },
    { repo: 'maddec01/lar-apple', onboarding: progress() }, { repo: 'maddec01/lar-cli', onboarding: progress('checks') }] }) });
  assert.deepEqual(dropRepository('MADDEC01/Lar-Apple', dir), [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-cli', onboarding: progress('checks') }]);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'repositories.json'), 'utf8')),
    { note: 'kept', repositories: [{ repo: 'maddec01/lar-factory', note: 'kept' }, { repo: 'maddec01/lar-cli', onboarding: progress('checks') }] });
  assert.throws(() => dropRepository('maddec01/lar-apple', dir), { message: "maddec01/lar-apple is not on this Mac's list." });
});

test('saving an onboarding for a repository that is onboarded already, or into a list that can\'t be read, is refused', async (t) => {
  const onboarded = await dataDir(t, { 'repositories.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-apple' }] }) });
  assert.throws(() => saveOnboarding({ repo: 'maddec01/lar-apple', progress: progress() }, null, onboarded), { message: 'maddec01/lar-apple is onboarded already.' });
  assert.throws(() => saveOnboarding({ repo: 'maddec01/lar-web', progress: progress() }, 'maddec01/lar-apple', onboarded), { message: 'maddec01/lar-apple is onboarded already.' });
  const broken = await dataDir(t, { 'repositories.json': '{ broken' });
  assert.throws(() => saveOnboarding({ repo: 'maddec01/lar-apple', progress: progress() }, null, broken), { message: `${join(broken, 'repositories.json')} isn't valid JSON.` });
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

test("an onboarded repository whose config can't be read is left out with its problem, and the others still read", async (t) => {
  const list = { repositories: [{ repo: 'maddec01/missing' }, { repo: 'maddec01/lar-factory' }, { repo: 'maddec01/broken' }, { repo: 'maddec01/some' }] };
  const dir = await dataDir(t, { 'repositories.json': JSON.stringify(list) });
  const gh = ghWith({ 'maddec01/lar-factory': { role: 'The factory' }, 'maddec01/broken': '{ broken', 'maddec01/some': { role: 'x', show: 'some' } });
  const { configs, problems } = await readOnboardedConfigs(readRepositoryList(dir), gh);
  assert.deepEqual(configs.map((c) => c.repo), ['maddec01/lar-factory']);
  assert.deepEqual(problems, [
    { repo: 'maddec01/missing', problem: 'no .lar-factory.json on its default branch.' },
    { repo: 'maddec01/broken', problem: ".lar-factory.json isn't valid JSON." },
    { repo: 'maddec01/some', problem: '.lar-factory.json field show must be "all" or "opted-in".' },
  ]);
});

test('a repository still onboarding or resetting reads no config and has no problem', async () => {
  const read: string[] = [];
  const gh = async (args: string[]) => {
    read.push(args[1]!);
    return JSON.stringify({ role: 'The factory' });
  };
  const list = [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-apple', onboarding: progress() }, { repo: 'maddec01/lar-web', resetting: { prUrl: RESET_PR } }];
  const { configs, problems, resetting } = await readOnboardedConfigs(list, gh);
  assert.deepEqual(configs.map((c) => c.repo), ['maddec01/lar-factory']);
  assert.deepEqual(problems, []);
  assert.deepEqual(resetting, ['maddec01/lar-web']);
  assert.deepEqual(read, ['repos/maddec01/lar-factory/contents/.lar-factory.json']);
});

test('a gh failure other than a 404 still fails the whole read', async (t) => {
  const dir = await dataDir(t, { 'repositories.json': JSON.stringify({ repositories: [{ repo: 'maddec01/lar-factory' }] }) });
  const gh = async () => { throw new Error('gh api failed: To get started with GitHub CLI, please run:  gh auth login'); };
  await assert.rejects(readOnboardedConfigs(readRepositoryList(dir), gh), /gh auth login/);
});
