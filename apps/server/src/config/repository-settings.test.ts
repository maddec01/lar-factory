import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { saveOnboarded, saveOnboarding } from './repository-config.ts';
import {
  acceptSetup, applySharedDefaults, readRepositorySetups, recheckAccess, recordAccess, setConsent, setOverride, sharedDefaultsOf,
} from './repository-settings.ts';

const REPO = 'maddec01/lar-apple';
const AZURE = 'contoso/Fabrikam/lar-api';

async function dataDir(t: TestContext, repos: string[] = [REPO]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar repository settings test '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'repository-settings.json'), JSON.stringify({ repositories: repos.map((repo) => ({ repo })) }));
  return dir;
}

const setupOf = (dir: string, repo = REPO) => readRepositorySetups(dir).find((s) => s.repo === repo)!;

test('a repository with no Repository config and no local settings works from the defaults', async (t) => {
  const dir = await dataDir(t, [REPO, AZURE]);
  assert.deepEqual(setupOf(dir), {
    repo: REPO, role: '', itemSource: { kind: 'issues' }, show: 'all', labels: [], domainDocs: { kind: 'private' }, skills: [],
    access: { 'push-branch': 'unverified', 'open-pr': 'unverified', 'publish-ticket': 'unverified', 'edit-ticket': 'unverified', 'tag-ticket': 'unverified' },
    consent: [], paused: [],
  });
  // An Azure DevOps repository has no item source until a team is named.
  assert.equal(setupOf(dir, AZURE).itemSource, null);
});

test('shared defaults sit beneath local overrides, and removing an override inherits the shared default again', async (t) => {
  const dir = await dataDir(t);
  applySharedDefaults(REPO, { defaults: { role: 'Apple app', skills: ['swift-style'], labels: ['area'] } }, dir);
  setOverride(REPO, 'role', 'My Apple client', dir);
  assert.equal(setupOf(dir).role, 'My Apple client');
  assert.deepEqual(setupOf(dir).skills, ['swift-style']);
  applySharedDefaults(REPO, { defaults: { role: 'The Apple app', skills: [] } }, dir);
  assert.equal(setupOf(dir).role, 'My Apple client');
  assert.deepEqual(setupOf(dir).skills, []);
  setOverride(REPO, 'role', undefined, dir);
  assert.equal(setupOf(dir).role, 'The Apple app');
});

test('an invalid or unreadable Repository config keeps the last usable shared defaults and says why; a removed one drops them', async (t) => {
  const dir = await dataDir(t);
  applySharedDefaults(REPO, { defaults: { role: 'Apple app' } }, dir);
  applySharedDefaults(REPO, { problem: ".lar-factory.json isn't valid JSON." }, dir);
  assert.equal(setupOf(dir).role, 'Apple app');
  assert.equal(setupOf(dir).sharedProblem, ".lar-factory.json isn't valid JSON.");
  applySharedDefaults(REPO, { defaults: { role: 'Apple app' } }, dir);
  assert.equal(setupOf(dir).sharedProblem, undefined);
  applySharedDefaults(REPO, null, dir);
  assert.equal(setupOf(dir).role, '');
});

test('an item-source or domain-doc-location change pauses until accepted, and other changes pause nothing', async (t) => {
  const dir = await dataDir(t, [AZURE]);
  const team = (name: string) => ({ kind: 'azure-board' as const, team: name });
  applySharedDefaults(AZURE, { defaults: { role: 'API', itemSource: team('API Team') } }, dir);
  applySharedDefaults(AZURE, { defaults: { role: 'The API', itemSource: team('API Team'), skills: ['tdd'] } }, dir);
  assert.deepEqual(setupOf(dir, AZURE).paused, []);
  applySharedDefaults(AZURE, { defaults: { itemSource: team('API Team'), domainDocs: { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' } } }, dir);
  assert.deepEqual(setupOf(dir, AZURE).paused, ['domainDocs']);
  setOverride(AZURE, 'itemSource', team('Platform Team'), dir);
  assert.deepEqual(setupOf(dir, AZURE).paused, ['itemSource', 'domainDocs']);
  acceptSetup(AZURE, dir);
  assert.deepEqual(setupOf(dir, AZURE).paused, []);
  // Changing back is a change too.
  setOverride(AZURE, 'itemSource', undefined, dir);
  assert.deepEqual(setupOf(dir, AZURE).paused, ['itemSource']);
});

test('an override that does not fit the repository is refused', async (t) => {
  const dir = await dataDir(t);
  assert.throws(() => setOverride(REPO, 'itemSource', { kind: 'azure-board', team: 'Team' }, dir),
    { message: `${REPO}: field itemSource must be {"kind": "issues"}.` });
});

test('access stays unverified until an operation is tried, and consent is kept but limited to the access available', async (t) => {
  const dir = await dataDir(t);
  setConsent(REPO, ['push-branch', 'open-pr', 'tag-ticket'], dir);
  recordAccess(REPO, 'push-branch', 'allowed', dir);
  recordAccess(REPO, 'tag-ticket', 'refused', dir);
  const setup = setupOf(dir);
  assert.equal(setup.access['push-branch'], 'allowed');
  assert.equal(setup.access['tag-ticket'], 'refused');
  assert.equal(setup.access['open-pr'], 'unverified');
  assert.deepEqual(setup.consent, ['push-branch', 'open-pr']);
  // After a credential change every operation is unverified again, and the consent the user gave comes back.
  recheckAccess(REPO, dir);
  assert.equal(setupOf(dir).access['tag-ticket'], 'unverified');
  assert.deepEqual(setupOf(dir).consent, ['push-branch', 'open-pr', 'tag-ticket']);
});

test('Repository config never supplies credentials or consent', () => {
  assert.deepEqual(sharedDefaultsOf({ role: 'Apple app', consent: ['open-pr'], access: { 'open-pr': 'allowed' } }, false), { defaults: { role: 'Apple app' } });
});

test('a Repository config with every field optional reads its shared defaults, and a wrong field is a problem', () => {
  assert.deepEqual(sharedDefaultsOf({}, false), { defaults: {} });
  assert.deepEqual(sharedDefaultsOf({ version: 1, role: 'API', itemSource: { kind: 'azure-board', team: 'Team' }, show: 'opted-in', labels: ['area'],
    domainDocs: { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' }, skills: ['tdd'] }, true), { defaults: {
    role: 'API', itemSource: { kind: 'azure-board', team: 'Team' }, show: 'opted-in', labels: ['area'],
    domainDocs: { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' }, skills: ['tdd'] } });
  for (const [raw, azure] of [[{ role: 3 }, false], [{ itemSource: { kind: 'issues' } }, true], [{ itemSource: { kind: 'azure-board' } }, true],
    [{ show: 'some' }, false], [{ labels: 'area' }, false], [{ domainDocs: { kind: 'repository' } }, false], [{ skills: [1] }, false]] as const) {
    assert.ok('problem' in sharedDefaultsOf(raw, azure), JSON.stringify(raw));
  }
});

test('settings survive a restart and an onboarding save, and the file keeps them under each entry', async (t) => {
  const dir = await dataDir(t, []);
  saveOnboarding({ repo: REPO, progress: { step: 'setup', done: ['project'], answers: { projectId: 'lar-apple' } } }, null, dir);
  setConsent(REPO, ['open-pr'], dir);
  saveOnboarded(REPO, null, dir);
  setOverride(REPO, 'role', 'Apple app', dir);
  assert.deepEqual(setupOf(dir).consent, ['open-pr']);
  assert.equal(setupOf(dir).role, 'Apple app');
  const file = JSON.parse(await readFile(join(dir, 'repository-settings.json'), 'utf8'));
  assert.deepEqual(file.repositories[0].settings.overrides, { role: 'Apple app' });
});

test("a list entry whose settings aren't usable is refused, naming its entry", async (t) => {
  const dir = await dataDir(t, []);
  await writeFile(join(dir, 'repository-settings.json'), JSON.stringify({ repositories: [{ repo: REPO, settings: { consent: ['fly'] } }] }));
  assert.throws(() => readRepositorySetups(dir), { message: `${join(dir, 'repository-settings.json')}: repositories[0] has local settings it can't use.` });
});

test('settings for a repository the list does not name are refused', async (t) => {
  const dir = await dataDir(t, []);
  assert.throws(() => setConsent(REPO, ['open-pr'], dir), { message: `${REPO} is not on this Mac's list.` });
});
