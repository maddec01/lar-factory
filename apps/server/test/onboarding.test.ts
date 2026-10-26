import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkouts } from './repo-support.ts';
import { readsRepositoryConfig, startBoard, until } from './server-support.ts';
import { projectsDb } from './stats-db.ts';
import type { BoardData } from '@lar-factory/shared';

/** Writes this Mac's list of repositories under `home` with the entries as given. */
function writeList(home: string, repositories: object[]): void {
  const dir = join(home, 'Library/Application Support/Lar Factory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'repositories.json'), JSON.stringify({ repositories }));
}

test("the onboarding T3 project step reads T3's projects with each repository's .lar-factory.json and place on the board", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  checkouts(home, { 'lar-web': 'git@github.com:maddec01/lar-web.git', 'lar-factory': 'git@github.com:maddec01/lar-factory.git' });
  const db = projectsDb(t, ['lar-web', 'lar-factory'].map((id) => ({ id, root: `${home}/Developer/lar/${id}` })));
  const board = await startBoard(t, { repositories: ['maddec01/lar-factory'], repoConfigs: { 'maddec01/lar-web': null } }, false, false,
    { HOME: home, T3_STATE_DB: db });
  const response = await fetch(`${board.url}/api/onboarding/projects`);
  assert.equal(response.status, 200);
  const { projects } = await response.json() as { projects: { name: string; hasConfig: boolean; onBoard: boolean }[] };
  assert.deepEqual(projects.map((p) => [p.name, p.hasConfig, p.onBoard]), [['lar-web', false, false], ['lar-factory', true, true]]);
});

test("T3's projects that can't be read answer with the problem", async (t) => {
  const board = await startBoard(t);
  const response = await fetch(`${board.url}/api/onboarding/projects`);
  assert.equal(response.status, 502);
  assert.match((await response.json() as { error: string }).error, /^Can't read T3 Code's projects at .*no-t3\.sqlite$/);
});

test('the sample board lists no T3 projects to onboard', async (t) => {
  const board = await startBoard(t, {}, true);
  const response = await fetch(`${board.url}/api/onboarding/projects`);
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
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'Library/Application Support/Lar Factory/repositories.json'), 'utf8')),
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
