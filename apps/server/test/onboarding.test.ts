import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkouts } from './repo-support.ts';
import { readsRepositoryConfig, SAMPLE_MODELS, startBoard, until } from './server-support.ts';
import { projectsDb } from './stats-db.ts';
import type { BoardData } from '@lar-factory/shared';
import { rawIssue } from '@lar-factory/shared/test/raw-items';

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
    // With no az, lar-api's check fails, so it offers nothing.
    false, true, { HOME: home, T3_STATE_DB: db, AZ_PATH: '/nowhere/az' });
  const data = await until(board, (d) => !!d.onboardingOffers);
  assert.deepEqual(data.onboardingOffers, [{ projectId: 'lar-web', name: 'lar-web', repo: 'maddec01/lar-web', provider: 'GitHub' }]);
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
  assert.deepEqual([unknown.status, await unknown.json()], [400, { error: 'Choose a repository and complete its settings before running checks.' }]);
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

test("onboarding's Clash agent runs on a fresh fetch of origin's default branch, and its runs read back by repository", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  const origin = join(home, 'origin');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args],
    { env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
  git('init', '-q', '-b', 'main', origin);
  git('-C', origin, 'commit', '-q', '--allow-empty', '-m', 'init');
  checkouts(home, { 'lar-web': origin });
  const db = projectsDb(t, [{ id: 'lar-web', root: `${home}/Developer/lar/lar-web` }]);
  const reply = JSON.stringify({ clashes: [{ file: 'AGENTS.md', line: 3, reason: 'Builders would push to main.', remove: ['Push to main.'], add: [] }] });
  const board = await startBoard(t, { t3: { waited: { reply } } }, false, false, { HOME: home, T3_STATE_DB: db, ...SAMPLE_MODELS });
  const model = { instanceId: 'claudeAgent_personal', model: 'claude-opus-5-5' };
  const started = await board.post({ repo: 'maddec01/lar-web', projectId: 'lar-web', model }, board.url, '/api/onboarding/clash-runs');
  assert.equal(started.status, 200);
  let runs: { state: string; threadId: string | null; clashes?: { file: string; line: number }[] }[] = [];
  for (let i = 0; i < 100 && runs[0]?.state !== 'done'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    runs = (await (await fetch(`${board.url}/api/onboarding/clash-runs?repo=maddec01/lar-web`)).json() as { runs: typeof runs }).runs;
  }
  assert.deepEqual(runs.map(({ state, threadId, clashes }) => [state, threadId, clashes?.map((c) => `${c.file}:${c.line}`)]),
    [['done', 'thread-1', ['AGENTS.md:3']]]);
  assert.equal(git('-C', `${home}/Developer/lar/lar-web`, 'rev-parse', 'origin/main').toString(), git('-C', origin, 'rev-parse', 'main').toString());
  const [start] = (await board.t3Calls()).filter((args) => args[0] === 'thread');
  assert.deepEqual(start?.slice(4), ['--title', start?.[5], '--provider', 'claudeAgent_personal', '--model', 'claude-opus-5-5', '--wait', '--json']);
  assert.match(start![3]!, /git show origin\/main:<path>/);
  const bad = await board.post({ repo: 'maddec01/lar-web', projectId: 'lar-web' }, board.url, '/api/onboarding/clash-runs');
  assert.equal(bad.status, 400);
});

test('an onboarding whose repository lacks a workflow label opens no PR, with a new or a reused .lar-factory.json', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  writeList(home, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const board = await startBoard(t, { repoLabels: { 'maddec01/lar-web': ['bug', 'decision: grill'] } } as object, false, false, { HOME: home });
  const refused = { error: 'maddec01/lar-web is missing a required label. Go back to Labels to create or rename it.' };
  for (const sent of [config, null]) {
    const response = await board.post({ repo: 'maddec01/lar-web', progress, config: sent, picks: { clashes: [], skills: {} } }, board.url, '/api/onboarding/pr');
    assert.deepEqual([response.status, await response.json()], [409, refused], JSON.stringify(sent));
  }
  assert.ok(!(await board.calls()).some((args) => args[0] === 'pr' && args[1] === 'create'));
  assert.deepEqual((await board.board() as BoardData).onboarding, [{ repo: 'maddec01/lar-web', progress }]);
});

test("the Labels step reads a repository's labels, creates the missing workflow labels and renames an old one", async (t) => {
  const board = await startBoard(t, { repoLabels: { 'maddec01/lar-web': ['bug', 'decision: grill', 'needs-triage'] } } as object);
  const labels = async (path: string, body: object = {}) => {
    const response = await board.post({ repo: 'maddec01/lar-web', ...body }, board.url, path);
    return [response.status, (await response.json() as { labels: string[] }).labels] as const;
  };
  assert.deepEqual(await labels('/api/onboarding/labels'), [200, ['bug', 'decision: grill', 'needs-triage']]);
  const [status, created] = await labels('/api/onboarding/labels/create', { itemSource: { kind: 'issues' }, renaming: ['decision: grill'] });
  assert.equal(status, 200);
  assert.ok(created!.includes('blocked') && created!.includes('status-list') && !created!.includes('decision-grill'));
  const [, renamed] = await labels('/api/onboarding/labels/rename', { names: ['decision: grill'] });
  assert.ok(renamed!.includes('decision-grill') && !renamed!.includes('decision: grill') && renamed!.includes('needs-triage'));
  const [, custom] = await labels('/api/onboarding/labels/custom', { name: 'app: music' });
  assert.ok(custom!.includes('app: music'));
});

test('the sample board runs no onboarding check, finds no Clash, runs no Clash agent and touches no label', async (t) => {
  const board = await startBoard(t, {}, true);
  for (const path of ['/api/onboarding/teams', '/api/onboarding/checks', '/api/onboarding/clashes', '/api/onboarding/clash-runs', '/api/onboarding/labels', '/api/onboarding/labels/create', '/api/onboarding/labels/rename', '/api/onboarding/labels/custom']) {
    const response = await board.post({ repo: 'maddec01/lar-web' }, board.url, path);
    assert.deepEqual([response.status, await response.json()], [403, { error: 'Sample mode onboards no repository.' }], path);
  }
  const runs = await fetch(`${board.url}/api/onboarding/clash-runs?repo=maddec01/lar-web`);
  assert.deepEqual([runs.status, await runs.json()], [403, { error: 'Sample mode onboards no repository.' }]);
});

const config = { itemSource: { kind: 'issues' }, show: 'opted-in', role: 'Web client', labels: [] };
const PR = 'https://github.com/maddec01/lar-web/pull/77';

test('opening the onboarding PR keeps its URL on the Pull request step, and its merge finishes onboarding on the next check', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  writeList(home, [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web', onboarding: progress }]);
  const board = await startBoard(t, { repoConfigs: { 'maddec01/lar-web': null } }, false, true, { HOME: home });
  await until(board, (d) => d.fetchedAt !== null);
  const response = await board.post({ repo: 'maddec01/lar-web', progress, config, picks: { clashes: [], skills: {} } }, board.url, '/api/onboarding/pr');
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
  const response = await board.post({ repo: 'maddec01/lar-web', progress, config, picks: { clashes: [], skills: {} } }, board.url, '/api/onboarding/pr');
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

test("Reset closes an onboarding's open PR and drops it from the board and the list", async (t) => {
  const { home, board } = await onPr(t, { repoConfigs: { 'maddec01/lar-web': null }, prs: { [PR]: 'OPEN' } });
  await until(board, (d) => d.onboarding?.length === 1);
  const response = await board.post({ repo: 'maddec01/lar-web' }, board.url, '/api/repositories/reset');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as { board: BoardData }).board.onboarding, []);
  assert.deepEqual((await board.calls()).filter((args) => args[0] === 'pr' && args[1] === 'close').map((args) => args.slice(0, 3)), [['pr', 'close', PR]]);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'Library/Application Support/Lar Factory/repositories.json'), 'utf8')),
    { repositories: [{ repo: 'maddec01/lar-factory' }] });
});

test("a Reset whose PR gh can't close answers with gh's message and keeps the onboarding", async (t) => {
  const { home, board } = await onPr(t, { repoConfigs: { 'maddec01/lar-web': null }, prs: { [PR]: 'OPEN' }, fail: 'pr-close' });
  await until(board, (d) => d.onboarding?.length === 1);
  const response = await board.post({ repo: 'maddec01/lar-web' }, board.url, '/api/repositories/reset');
  assert.deepEqual([response.status, await response.json()], [502, { error: "Can't close maddec01/lar-web's onboarding PR: gh pr close failed: HTTP 403: Resource not accessible by integration" }]);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'Library/Application Support/Lar Factory/repositories.json'), 'utf8')).repositories,
    [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web', onboarding: { ...progress, step: 'pr', prUrl: PR } }]);
});

test('Reset of an onboarded repository opens its reset PR and takes it off the board, with its items, also after a restart', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  writeList(home, [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web' }]);
  const options = { files: ['.lar-factory.json', 'AGENTS.md'], items: [rawIssue('I_1', 1, 'List', []), rawIssue('I_2', 2, 'List', [], { repository: { nameWithOwner: 'maddec01/lar-web' } })] };
  const board = await startBoard(t, options, false, false, { HOME: home });
  await until(board, (d) => d.items.length === 2);
  const response = await board.post({ repo: 'maddec01/lar-web' }, board.url, '/api/repositories/reset');
  assert.equal(response.status, 200);
  const { board: data, prUrl } = await response.json() as { board: BoardData; prUrl: string };
  assert.equal(prUrl, PR);
  assert.deepEqual(data.resetting, [{ repo: 'maddec01/lar-web', prUrl: PR }]);
  assert.deepEqual([data.repos.map((r) => r.repo), data.items.map((i) => i.number)], [['maddec01/lar-factory'], [1]]);
  assert.deepEqual((await board.calls()).filter((args) => args[0] === 'pr' && args[1] === 'create').map((args) => args[args.indexOf('--head') + 1]), ['lar-factory/reset']);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'Library/Application Support/Lar Factory/repositories.json'), 'utf8')).repositories,
    [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web', resetting: { prUrl: PR } }]);
  await board.stop();
  const restarted = await startBoard(t, options, false, false, { HOME: home });
  const read = await until(restarted, (d) => d.fetchedAt !== null);
  assert.deepEqual(read.resetting, [{ repo: 'maddec01/lar-web', prUrl: PR }]);
  assert.deepEqual([read.repos.map((r) => r.repo), read.items.map((i) => i.number), read.onboarding, read.repositoryConfigProblems],
    [['maddec01/lar-factory'], [1], [], []]);
  assert.ok(!(await restarted.calls()).some((args) => readsRepositoryConfig(args) && args[1]!.includes('lar-web')));
});

test("a Reset whose reset PR can't be opened answers with gh's message and keeps the repository onboarded", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-onboarding-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  writeList(home, [{ repo: 'maddec01/lar-web' }]);
  const board = await startBoard(t, { files: ['.lar-factory.json'], fail: 'pr-create' }, false, false, { HOME: home });
  const response = await board.post({ repo: 'maddec01/lar-web' }, board.url, '/api/repositories/reset');
  assert.equal(response.status, 502);
  assert.match((await response.json() as { error: string }).error, /^Can't open maddec01\/lar-web's reset PR: gh pr create failed: /);
  assert.deepEqual(JSON.parse(readFileSync(join(home, 'Library/Application Support/Lar Factory/repositories.json'), 'utf8')).repositories, [{ repo: 'maddec01/lar-web' }]);
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

test('the sample board opens, reopens and resets no onboarding PR', async (t) => {
  const board = await startBoard(t, {}, true);
  for (const path of ['/api/onboarding/pr', '/api/onboarding/pr/changes', '/api/onboarding/pr/reopen', '/api/repositories/reset']) {
    const response = await board.post({ repo: 'maddec01/lar-web', progress, config }, board.url, path);
    assert.deepEqual([response.status, await response.json()], [403, { error: 'Sample mode onboards no repository.' }], path);
  }
});

test('label creation streams successful updates through the guarded HTTP route', async (t) => {
  const board = await startBoard(t);
  const response = await fetch(`${board.url}/api/onboarding/labels/create`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson', Origin: board.url },
    body: JSON.stringify({ repo: 'maddec01/lar-web', itemSource: { kind: 'issues' }, renaming: [] }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /application\/x-ndjson/);
  const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.ok(events[0].progress.labels.length > 0);
  assert.equal(events.at(-1).result.error, null);
});

test('a listed repository with an unsupported config remains offered for fresh onboarding', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-recovery-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  checkouts(home, { 'lar-web': 'git@github.com:maddec01/lar-web.git' });
  const db = projectsDb(t, [{ id: 'lar-web', root: `${home}/Developer/lar/lar-web` }]);
  const board = await startBoard(t, { repositories: ['maddec01/lar-web', 'maddec01/lar-factory'], repoConfigs: {
    'maddec01/lar-web': { role: 'Web', itemSource: { kind: 'github-project', owner: 'maddec01', number: 3 } },
  } }, false, false, { HOME: home, T3_STATE_DB: db });
  const data = await until(board, (data) => !!data.onboardingOffers?.some((offer) => offer.repo === 'maddec01/lar-web'));
  assert.ok(data.repos.some((repo) => repo.repo === 'maddec01/lar-factory'));
  assert.ok(data.onboardingOffers?.[0]?.configProblem);
  const response = await board.post({ repo: 'maddec01/lar-web', progress: { step: 'setup', done: ['project'], answers: { projectId: 'lar-web' } } }, board.url, '/api/onboarding/repositories');
  assert.equal(response.status, 200);
  const kept = await response.json() as { board: BoardData };
  assert.equal(kept.board.onboarding?.[0]?.repo, 'maddec01/lar-web');
});
