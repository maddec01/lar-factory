import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkouts } from './repo-support.ts';
import { readsRepositoryConfig, SAMPLE_MODELS, startBoard, until, writesRepository } from './server-support.ts';
import { projectsDb } from './stats-db.ts';
import type { BoardData, SetupDetection } from '@lar-factory/shared';

/** Writes this Mac's list of repositories under `home` with the entries as given. */
function writeList(home: string, repositories: object[]): void {
  const dir = join(home, 'Library/Application Support/Lar Factory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'repository-settings.json'), JSON.stringify({ repositories }));
}

/** This Mac's list under `home` as the file holds it, leaving out each entry's local settings, which the board's reads add. */
function listFile(home: string): { repositories: Record<string, unknown>[] } {
  const file = JSON.parse(readFileSync(join(home, 'Library/Application Support/Lar Factory/repository-settings.json'), 'utf8'));
  return { ...file, repositories: file.repositories.map(({ settings: _, ...entry }: Record<string, unknown>) => entry) };
}

test("the onboarding T3 project step reads T3's projects with each origin and place on the board", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  checkouts(home, { 'lar-web': 'git@github.com:maddec01/lar-web.git', 'lar-factory': 'git@github.com:maddec01/lar-factory.git' });
  const db = projectsDb(t, ['lar-web', 'lar-factory'].map((id) => ({ id, root: `${home}/Developer/lar/${id}` })));
  const board = await startBoard(t, { repositories: ['maddec01/lar-factory'], localSetups: { 'maddec01/lar-web': null } }, false, false,
    { HOME: home, T3_STATE_DB: db });
  const response = await fetch(`${board.url}/api/onboarding/projects`);
  assert.equal(response.status, 200);
  const { projects } = await response.json() as { projects: { name: string; onBoard: boolean }[] };
  assert.deepEqual(projects.map((p) => [p.name, p.onBoard]), [['lar-web', false], ['lar-factory', true]]);
});

test("T3's projects that can't be read answer with the problem", async (t) => {
  const board = await startBoard(t);
  const response = await fetch(`${board.url}/api/onboarding/projects`);
  assert.equal(response.status, 502);
  assert.match((await response.json() as { error: string }).error, /^Can't read T3 Code's projects; reconnect T3 Code before onboarding$/);
});

test('the sample board lists no T3 projects to onboard', async (t) => {
  const board = await startBoard(t, {}, true);
  const response = await fetch(`${board.url}/api/onboarding/projects`);
  assert.deepEqual([response.status, await response.json()], [403, { error: 'Sample mode onboards no repository.' }]);
});

test('creating a T3 project runs t3 project add on the folder and answers with the new project to pick', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  checkouts(home, { 'lar-web': 'git@github.com:maddec01/lar-web.git' });
  const db = projectsDb(t, []);
  const board = await startBoard(t, { repositories: [], localSetups: { 'maddec01/lar-web': null } }, false, false, { HOME: home, T3_STATE_DB: db });
  const response = await board.post({ folder: '~/Developer/lar/lar-web' }, board.url, '/api/onboarding/projects');
  assert.equal(response.status, 200);
  const { projects, projectId } = await response.json() as { projects: { id: string; repo: string }[]; projectId: string };
  assert.equal(projectId, 'added');
  assert.deepEqual(projects.map((p) => [p.id, p.repo]), [['added', 'maddec01/lar-web']]);
  assert.deepEqual(await board.t3Calls(), [['project', 'add', join(home, 'Developer/lar/lar-web')]]);
});

test("a failing t3 project add answers with t3's message", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  const board = await startBoard(t, { t3: { addFails: 'Could not reach the T3 Code server.' } }, false, false, { HOME: home });
  const response = await board.post({ folder: home }, board.url, '/api/onboarding/projects');
  assert.deepEqual([response.status, await response.json()], [502, { error: 't3 could not add the project: Could not reach the T3 Code server.' }]);
});

test('the sample board creates no T3 project', async (t) => {
  const board = await startBoard(t, {}, true);
  const response = await board.post({ folder: '/tmp' }, board.url, '/api/onboarding/projects');
  assert.deepEqual([response.status, await response.json()], [403, { error: 'Sample mode onboards no repository.' }]);
});

const progress = { step: 'setup', done: ['project'], answers: { projectId: 'lar-web' } };

test('a repository still onboarding is in the board data with its progress, and the board reads no Repository config for it', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  writeList(home, [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web', onboarding: progress }]);
  const board = await startBoard(t, {}, false, false, { HOME: home });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(data.repos.map((r) => r.repo), ['maddec01/lar-factory']);
  assert.deepEqual(data.onboarding, [{ repo: 'maddec01/lar-web', progress }]);
  assert.deepEqual(data.repositoryConfigProblems, []);
  assert.ok(!(await board.calls()).some((args) => readsRepositoryConfig(args) && args[1]!.includes('lar-web')));
});

test('closing onboarding keeps its repository on the list as onboarding, which the board shows at once and after a restart', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  const board = await startBoard(t, { repositories: null }, false, false, { HOME: home });
  const response = await board.post({ repo: 'maddec01/lar-web', progress }, board.url, '/api/onboarding/repositories');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { board: BoardData }).board.onboarding, [{ repo: 'maddec01/lar-web', progress }]);
  assert.deepEqual(listFile(home),
    { repositories: [{ repo: 'maddec01/lar-web', onboarding: progress }] });
  await board.stop();
  const restarted = await startBoard(t, {}, false, false, { HOME: home });
  assert.deepEqual((await restarted.board() as BoardData).onboarding, [{ repo: 'maddec01/lar-web', progress }]);
});

test('keeping an onboarding without its progress, or for a repository onboarded already, is refused', async (t) => {
  const board = await startBoard(t, { repositories: ['maddec01/lar-web'] });
  const keep = (body: object) => board.post(body, board.url, '/api/onboarding/repositories');
  const unsent = await keep({ repo: 'maddec01/lar-web', progress: { step: 'setup' } });
  assert.deepEqual([unsent.status, await unsent.json()], [400, { error: 'Send the repository and where its onboarding stopped.' }]);
  const onboarded = await keep({ repo: 'maddec01/lar-web', progress });
  assert.deepEqual([onboarded.status, await onboarded.json()], [409, { error: 'maddec01/lar-web is onboarded already.' }]);
});

test('the sample board keeps no onboarding', async (t) => {
  const board = await startBoard(t, {}, true);
  const response = await board.post({ repo: 'maddec01/lar-web', progress }, board.url, '/api/onboarding/repositories');
  assert.deepEqual([response.status, await response.json()], [403, { error: 'Sample mode onboards no repository.' }]);
});

/** Whether a gh call writes to a repository: a POST, PATCH, PUT or DELETE through the API, or a label, issue or PR change. */
const ANSWERS = { structureSync: false, projectId: 'lar-web', role: 'Web client', itemSource: { kind: 'issues' }, domainDocs: { kind: 'private' }, skills: [], consent: ['push-branch', 'open-pr'] };

test('a repository with no factory files is detected and onboards with no write to it, its answers saved as local settings', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  writeList(home, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const board = await startBoard(t, { canPush: false, files: ['README.md'], localSetups: { 'maddec01/lar-web': null } }, false, true, { HOME: home });
  const detected = await board.post({ repo: 'maddec01/lar-web', projectId: 'lar-web' }, board.url, '/api/onboarding/detect');
  assert.equal(detected.status, 200);
  const { detection } = await detected.json() as { detection: SetupDetection };
  assert.deepEqual([detection.domainDocs, detection.access['push-branch']],
    [{ found: { kind: 'private' } }, 'refused']);
  const saved = await board.post({ repo: 'maddec01/lar-web', ...ANSWERS }, board.url, '/api/onboarding/setup');
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json() as { board: BoardData }).board.onboarding, []);
  const data = await until(board, (d) => d.repos.some((r) => r.repo === 'maddec01/lar-web'));
  assert.deepEqual(data.repos.find((r) => r.repo === 'maddec01/lar-web')?.role, 'Web client');
  const settings = JSON.parse(readFileSync(join(home, 'Library/Application Support/Lar Factory/repository-settings.json'), 'utf8')).repositories[0].settings;
  assert.deepEqual([settings.projectId, settings.consent, settings.access['push-branch']], ['lar-web', undefined, 'refused']);
  assert.deepEqual((await board.calls()).filter(writesRepository), []);
});

test('detection and saving refuse a body they cannot use', async (t) => {
  const board = await startBoard(t);
  const detected = await board.post({ repo: 'maddec01/lar-web' }, board.url, '/api/onboarding/detect');
  assert.deepEqual([detected.status, await detected.json()], [400, { error: 'Choose a repository and its T3 project before detecting its setup.' }]);
  const saved = await board.post({ repo: 'maddec01/lar-web', ...ANSWERS, consent: ['merge'] }, board.url, '/api/onboarding/setup');
  assert.deepEqual([saved.status, await saved.json()],
    [400, { error: 'Send the repository, its T3 project, role, item source, domain-doc location, skills.' }]);
});

test('the sample board detects nothing, saves no setup and imports no ticket', async (t) => {
  const board = await startBoard(t, {}, true);
  for (const path of ['/api/onboarding/detect', '/api/onboarding/setup']) {
    const response = await board.post({ repo: 'maddec01/lar-web' }, board.url, path);
    assert.deepEqual([response.status, await response.json()], [403, { error: 'Sample mode onboards no repository.' }], path);
  }
});

test("Clash resolution waits for a later build, so onboarding's Clash routes are gone", async (t) => {
  const board = await startBoard(t, {}, true);
  for (const path of ['/api/onboarding/clashes', '/api/onboarding/clash-runs']) {
    assert.equal((await board.post({ repo: 'maddec01/lar-web' }, board.url, path)).status, 405, path);
  }
  assert.equal((await fetch(`${board.url}/api/onboarding/clash-runs?repo=maddec01/lar-web`)).status, 404);
});


test('repository setup and per-ticket import write routes are absent', async (t) => {
  const board = await startBoard(t, {}, true);
  for (const path of ['/api/onboarding/import', '/api/onboarding/import/tickets', '/api/onboarding/pr', '/api/onboarding/pr/changes', '/api/repositories/config-update/pr', '/api/repositories/config-update/dismiss']) {
    assert.equal((await board.post({}, board.url, path)).status, 405, path);
  }
});

test('a fine-grained read-only token cannot enable concept sync for a push-capable user', async (t) => {
  const board = await startBoard(t, { repositories: [], oauthScopes: null });
  const detected = await board.post({ repo: 'maddec01/lar-web', projectId: 'lar-web' }, board.url, '/api/onboarding/detect');
  const { detection } = await detected.json() as { detection: SetupDetection };
  assert.ok(Object.values(detection.access).every((value) => value === 'unverified'));
  const saved = await board.post({ repo: 'maddec01/lar-web', ...ANSWERS, structureSync: true }, board.url, '/api/onboarding/setup');
  assert.equal(saved.status, 403);
  const error = (await saved.json() as { error: string }).error;
  assert.match(error, /Issues: Read and write/);
  assert.match(error, /cannot verify fine-grained token permissions/);
  assert.deepEqual((await board.board()).repos, []);
  assert.deepEqual((await board.calls()).filter(writesRepository), []);
});
