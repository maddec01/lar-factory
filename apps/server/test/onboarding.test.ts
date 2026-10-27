import { test, type TestContext } from 'vite-plus/test';
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

test('the board offers each T3 project whose repository has .lar-factory.json, reading each answer once until Recheck', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  const origins = { 'lar-web': 'git@github.com:maddec01/lar-web.git', 'lar-docs': 'git@github.com:maddec01/lar-docs.git',
    'lar-cli': 'git@github.com:maddec01/lar-cli.git', 'lar-factory': 'git@github.com:maddec01/lar-factory.git',
    'lar-api': 'https://contoso@dev.azure.com/contoso/Fabrikam/_git/lar-api' };
  checkouts(home, origins);
  const db = projectsDb(t, Object.keys(origins).map((id) => ({ id, root: `${home}/Developer/lar/${id}` })));
  const board = await startBoard(t, { repositories: ['maddec01/lar-factory'], repoConfigs: { 'maddec01/lar-docs': false, 'maddec01/lar-cli': null } },
    false, true, { HOME: home, T3_STATE_DB: db });
  const data = await until(board, (d) => !!d.onboardingOffers);
  assert.deepEqual(data.onboardingOffers, [{ projectId: 'lar-web', name: 'lar-web', repo: 'maddec01/lar-web' }]);
  const reads = async (repo: string) => (await board.calls()).filter((args) => readsRepositoryConfig(args) && args[1] === `repos/${repo}/contents/.lar-factory.json`).length;
  // More refreshes read lar-factory's items, but no answer they have already.
  const refreshed = await reads('maddec01/lar-factory');
  for (let i = 0; i < 40 && await reads('maddec01/lar-factory') < refreshed + 2; i++) await new Promise((r) => setTimeout(r, 25));
  assert.deepEqual([await reads('maddec01/lar-web'), await reads('maddec01/lar-cli')], [1, 1]);
  // A failed check offers nothing, logs once, and is tried again on the next refresh.
  for (let i = 0; i < 40 && await reads('maddec01/lar-docs') < 2; i++) await new Promise((r) => setTimeout(r, 25));
  assert.ok(await reads('maddec01/lar-docs') > 1);
  assert.equal(board.logs().split("can't tell whether maddec01/lar-docs has .lar-factory.json: ").length, 2);
  await board.post({}, board.url, '/api/recheck');
  for (let i = 0; i < 40 && await reads('maddec01/lar-web') < 2; i++) await new Promise((r) => setTimeout(r, 25));
  assert.equal(await reads('maddec01/lar-web'), 2);
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

test('creating a T3 project runs t3 project add on the folder and answers with the new project to pick', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  checkouts(home, { 'lar-web': 'git@github.com:maddec01/lar-web.git' });
  const db = projectsDb(t, []);
  const board = await startBoard(t, { repositories: [], repoConfigs: { 'maddec01/lar-web': null } }, false, false, { HOME: home, T3_STATE_DB: db });
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

test('an onboarding setup check answers with its result', async (t) => {
  const board = await startBoard(t, { canPush: false });
  const check = (body: object) => board.post({ repo: 'maddec01/lar-web', projectId: 'lar-web', itemSource: { kind: 'issues' }, ...body }, board.url, '/api/onboarding/checks');
  const push = await check({ check: 'push' });
  assert.deepEqual([push.status, (await push.json() as { result: { passed: boolean } }).result.passed], [200, false]);
  const unknown = await check({ check: 'labels' });
  assert.deepEqual([unknown.status, await unknown.json()], [400, { error: 'Send the check to run, the repository, its T3 project and its item source.' }]);
});

test("onboarding's fixed checks answer with the default branch's Clashes, or gh's problem", async (t) => {
  const board = await startBoard(t, { files: ['CONTEXT.md', '.claude/skills/tdd/SKILL.md', '.claude/skills/web-deploy/SKILL.md'] });
  const response = await board.post({ repo: 'maddec01/lar-web' }, board.url, '/api/onboarding/clashes');
  const found = await response.json() as { clashes: { id: string }[]; skillClashes: unknown; projectSkills: string[] };
  assert.deepEqual([response.status, found.clashes.map((c) => c.id), found.skillClashes, found.projectSkills],
    [200, ['context'], [{ name: 'tdd', path: '.claude/skills/tdd/' }], ['tdd', 'web-deploy']]);
  await board.update({ fail: 'tree' });
  const failed = await board.post({ repo: 'maddec01/lar-web' }, board.url, '/api/onboarding/clashes');
  assert.equal(failed.status, 502);
  assert.match((await failed.json() as { error: string }).error, /^Can't read maddec01\/lar-web's default branch: .*HTTP 502/);
});

test('finishing an onboarding that reuses .lar-factory.json puts its repository on the board', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  writeList(home, [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web', onboarding: progress }]);
  const board = await startBoard(t, {}, false, false, { HOME: home });
  await until(board, (d) => d.fetchedAt !== null);
  const response = await board.post({ repo: 'maddec01/lar-web' }, board.url, '/api/onboarding/finish');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { board: BoardData }).board.onboarding, []);
  const data = await until(board, (d) => d.repos.length === 2);
  assert.deepEqual(data.repos.map((r) => r.repo), ['maddec01/lar-factory', 'maddec01/lar-web']);
});

test('the sample board runs no onboarding check, finds no Clash and finishes no onboarding', async (t) => {
  const board = await startBoard(t, {}, true);
  for (const path of ['/api/onboarding/checks', '/api/onboarding/clashes', '/api/onboarding/finish']) {
    const response = await board.post({ repo: 'maddec01/lar-web' }, board.url, path);
    assert.deepEqual([response.status, await response.json()], [403, { error: 'Sample mode onboards no repository.' }], path);
  }
});

const config = { itemSource: { kind: 'issues' }, show: 'opted-in', role: 'Web client' };
const PR = 'https://github.com/maddec01/lar-web/pull/77';

test('opening the onboarding PR keeps its URL on the Pull request step, and its merge finishes onboarding on the next check', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  writeList(home, [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web', onboarding: progress }]);
  const board = await startBoard(t, { repoConfigs: { 'maddec01/lar-web': null } }, false, true, { HOME: home });
  await until(board, (d) => d.fetchedAt !== null);
  const response = await board.post({ repo: 'maddec01/lar-web', progress, config }, board.url, '/api/onboarding/pr');
  assert.equal(response.status, 200);
  const opened = { step: 'pr', done: ['project', 'setup'], answers: { projectId: 'lar-web' }, prUrl: PR };
  const body = await response.json() as { prUrl: string; board: BoardData };
  assert.deepEqual([body.prUrl, body.board.onboarding], [PR, [{ repo: 'maddec01/lar-web', progress: opened }]]);
  assert.deepEqual((await board.calls()).filter((args) => args[0] === 'pr' && args[1] === 'create').length, 1);
  await board.update({ repoConfigs: { 'maddec01/lar-web': { role: 'Web client', itemSource: { kind: 'issues' } } }, prs: { [PR]: 'MERGED' } });
  const data = await until(board, (d) => d.repos.length === 2);
  assert.deepEqual([data.repos.map((r) => r.repo), data.onboarding], [['maddec01/lar-factory', 'maddec01/lar-web'], []]);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'Library/Application Support/Lar Factory/repositories.json'), 'utf8')),
    { repositories: [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web' }] });
});

test("a failing gh pr create answers with gh's message and keeps the onboarding where it was", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  writeList(home, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const board = await startBoard(t, { fail: 'pr-create' }, false, false, { HOME: home });
  const response = await board.post({ repo: 'maddec01/lar-web', progress, config }, board.url, '/api/onboarding/pr');
  assert.equal(response.status, 502);
  assert.match((await response.json() as { error: string }).error,
    /^Can't open maddec01\/lar-web's onboarding PR: gh pr create failed: .*No commits between main and lar-factory\/onboarding/);
  assert.deepEqual((await board.board() as BoardData).onboarding, [{ repo: 'maddec01/lar-web', progress }]);
});

/** A board whose list has lar-web onboarding with its PR open, and lar-factory onboarded; `options` set the fake gh. */
async function onPr(t: TestContext, options: object) {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  writeList(home, [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web', onboarding: { ...progress, step: 'pr', prUrl: PR } }]);
  return { home, board: await startBoard(t, options, false, true, { HOME: home }) };
}

test('a PR closed without merging shows on the board as closed, and Reopen PR reopens it', async (t) => {
  const { board } = await onPr(t, { repoConfigs: { 'maddec01/lar-web': null }, prs: { [PR]: 'CLOSED' } });
  const closed = await until(board, (d) => !!d.onboarding?.[0]?.progress.prClosed);
  assert.deepEqual(closed.onboarding, [{ repo: 'maddec01/lar-web', progress: { ...progress, step: 'pr', prUrl: PR, prClosed: true } }]);
  const response = await board.post({ repo: 'maddec01/lar-web' }, board.url, '/api/onboarding/pr/reopen');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { board: BoardData }).board.onboarding, [{ repo: 'maddec01/lar-web', progress: { ...progress, step: 'pr', prUrl: PR } }]);
  assert.deepEqual((await board.calls()).filter((args) => args[0] === 'pr' && args[1] === 'reopen'), [['pr', 'reopen', PR]]);
});

test("a Reopen PR that gh refuses answers with gh's message and keeps the PR closed", async (t) => {
  const { board } = await onPr(t, { repoConfigs: { 'maddec01/lar-web': null }, prs: { [PR]: 'CLOSED' }, fail: 'pr-reopen' });
  await until(board, (d) => !!d.onboarding?.[0]?.progress.prClosed);
  const response = await board.post({ repo: 'maddec01/lar-web' }, board.url, '/api/onboarding/pr/reopen');
  assert.deepEqual([response.status, await response.json()], [502, { error: "Can't reopen maddec01/lar-web's onboarding PR: gh pr reopen failed: HTTP 403: Resource not accessible by integration" }]);
});

test('a .lar-factory.json that lands another way finishes onboarding and closes the PR with a comment', async (t) => {
  const { home, board } = await onPr(t, { repoConfigs: { 'maddec01/lar-web': { role: 'Web client', itemSource: { kind: 'issues' } } }, prs: { [PR]: 'OPEN' } });
  const data = await until(board, (d) => d.repos.length === 2);
  assert.deepEqual(data.onboarding, []);
  const close = (await board.calls()).filter((args) => args[0] === 'pr' && args[1] === 'close');
  assert.deepEqual(close.map((args) => args.slice(0, 4)), [['pr', 'close', PR, '--comment']]);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'Library/Application Support/Lar Factory/repositories.json'), 'utf8')),
    { repositories: [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web' }] });
});

test('the sample board opens and reopens no onboarding PR', async (t) => {
  const board = await startBoard(t, {}, true);
  for (const path of ['/api/onboarding/pr', '/api/onboarding/pr/reopen']) {
    const response = await board.post({ repo: 'maddec01/lar-web', progress, config }, board.url, path);
    assert.deepEqual([response.status, await response.json()], [403, { error: 'Sample mode onboards no repository.' }], path);
  }
});
