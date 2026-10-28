import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoardData } from '@lar-factory/shared';
import { projectIssue } from '@lar-factory/shared/test/raw-items';
import { startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

const APPLE = 'maddec01/lar-apple';
const FACTORY = 'maddec01/lar-factory';
const LAR = { kind: 'github-project', owner: 'maddec01', number: 1 };

const appleIssue = (number: number, labels: string[] = []) =>
  ({ ...projectIssue(number, 'List', APPLE).content!, labels: { nodes: labels.map((name) => ({ name })) } });

const projectReads = async (board: Board) => (await board.calls()).filter((args) => args.some((a) => a.includes('projectV2(number'))).length;
const configReads = async (board: Board) => (await board.calls()).filter((args) => args[1]?.endsWith('/.lar-factory.json')).length;

test('each onboarded repository reads its items from the item source its .lar-factory.json names, with its show setting and custom labels', async (t) => {
  const board = await startBoard(t, {
    repositories: [FACTORY, APPLE],
    repoConfigs: { [FACTORY]: { version: 1, role: 'The factory', itemSource: LAR, show: 'all', labels: [] },
      [APPLE]: { role: 'Apple client', itemSource: { kind: 'issues' }, show: 'opted-in', labels: ['app: music'] } },
    items: [projectIssue(1, 'Queued', FACTORY), projectIssue(2, 'List', FACTORY)],
    repoIssues: { [APPLE]: [appleIssue(7, ['status-queued']), appleIssue(8)] },
  });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.equal(data.error, null);
  assert.deepEqual(data.items.map((i) => [i.repo, i.number, i.status]), [[FACTORY, 1, 'Queued'], [FACTORY, 2, 'List'], [APPLE, 7, 'Queued']]);
  assert.deepEqual(data.repos, [{ repo: FACTORY, role: 'The factory', items: 'project', project: { owner: LAR.owner, number: LAR.number }, show: 'all', labels: [], version: 1 },
    { repo: APPLE, role: 'Apple client', items: 'issues', show: 'opted-in', labels: ['app: music'], version: 1 }]);
  assert.equal(data.project.title, 'lar');
});

test('repositories naming the same Project share one read of it, and a missing field takes its default', async (t) => {
  const board = await startBoard(t, { repoConfigs: { 'maddec01/lar-server': { role: 'Server', itemSource: LAR } } });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.equal(await projectReads(board), 1);
  assert.equal(await configReads(board), 3);
  assert.deepEqual(data.repos[0], { repo: 'maddec01/lar-server', role: 'Server', items: 'project', project: { owner: LAR.owner, number: LAR.number }, show: 'all', labels: [], version: 1 });
});

test('without a list of onboarded repositories the board is empty', async (t) => {
  const board = await startBoard(t, { repositories: null, items: [projectIssue(1, 'Queued', FACTORY)] });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual([data.items, data.repos, data.error], [[], [], null]);
  assert.equal(await projectReads(board), 0);
});

test("a list that isn't valid JSON stops the read with the board's read error, naming the file", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-broken-list-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'Library/Application Support/Lar Factory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'repositories.json'), '{ broken');
  const board = await startBoard(t, { items: [projectIssue(1, 'Queued', FACTORY)] }, false, false, { HOME: home });
  const data = await until(board, (d) => d.error !== null);
  assert.equal(data.error, `${join(dir, 'repositories.json')} isn't valid JSON.`);
  assert.deepEqual(data.items, []);
});

test("a settings file that isn't valid JSON leaves the board on its defaults, with the board's read error naming the file", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-broken-settings-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'Library/Application Support/Lar Factory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), '{ broken');
  const board = await startBoard(t, { repositories: [FACTORY], repoConfigs: { [FACTORY]: { role: 'The factory', itemSource: LAR } },
    items: [projectIssue(1, 'Queued', FACTORY)] }, false, false, { HOME: home });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.equal(data.error, `${join(dir, 'settings.json')} isn't valid JSON.`);
  assert.equal(data.refreshSeconds, 300);
  assert.deepEqual(data.items.map((i) => i.number), [1]);
});

test("a list that stops being valid JSON clears the repositories and notices of the last read", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-list-breaks-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const options = { repositories: [FACTORY, APPLE], repoConfigs: { [FACTORY]: { role: 'The factory', itemSource: LAR }, [APPLE]: null },
    items: [projectIssue(1, 'Queued', FACTORY)] };
  const board = await startBoard(t, options, false, true, { HOME: home });
  await until(board, (d) => d.repos.length === 1 && !!d.repositoryConfigProblems?.length);
  writeFileSync(join(home, 'Library/Application Support/Lar Factory/repositories.json'), '{ broken');
  const data = await until(board, (d) => d.error !== null);
  assert.deepEqual([data.repos, data.repositoryConfigProblems], [[], []]);
});

test('a change to a .lar-factory.json shows on the next refresh', async (t) => {
  const options = { repositories: [APPLE], repoConfigs: { [APPLE]: { role: 'Apple client', itemSource: LAR } },
    items: [projectIssue(1, 'Queued', APPLE)], repoIssues: { [APPLE]: [appleIssue(7)] } };
  const board = await startBoard(t, options, false, true);
  await until(board, (d) => d.items.map((i) => i.number).join() === '1');
  await board.update({ ...options, repoConfigs: { [APPLE]: { role: 'Apple client', itemSource: { kind: 'issues' } } } });
  const data: BoardData = await until(board, (d) => d.items.map((i) => i.number).join() === '7');
  assert.deepEqual(data.repos, [{ repo: APPLE, role: 'Apple client', items: 'issues', show: 'all', labels: [], version: 1 }]);
});

test("a repository whose .lar-factory.json is missing, doesn't parse or has a wrong field stays off the board with a notice, the others still show", async (t) => {
  const broken = { 'no file': null, 'unparsable': '{ broken', 'wrong field': { role: 'Apple client', itemSource: { kind: 'sprint' } } };
  const problems = { 'no file': 'no .lar-factory.json on its default branch.', 'unparsable': ".lar-factory.json isn't valid JSON.",
    'wrong field': '.lar-factory.json field itemSource.kind must be "issues" or "github-project".' };
  for (const [name, config] of Object.entries(broken)) {
    const board = await startBoard(t, { repositories: [FACTORY, APPLE], repoConfigs: { [FACTORY]: { role: 'The factory', itemSource: LAR }, [APPLE]: config },
      items: [projectIssue(1, 'Queued', FACTORY), projectIssue(2, 'Queued', APPLE)], repoIssues: { [APPLE]: [appleIssue(7)] } });
    const data = await until(board, (d) => d.fetchedAt !== null);
    assert.equal(data.error, null, name);
    assert.deepEqual(data.items.map((i) => [i.repo, i.number]), [[FACTORY, 1]], name);
    assert.deepEqual(data.repos.map((r) => r.repo), [FACTORY], name);
    assert.deepEqual(data.repositoryConfigProblems, [{ repo: APPLE, problem: problems[name as keyof typeof problems] }], name);
  }
});

test('the notice clears on the first refresh that reads the file', async (t) => {
  const options = { repositories: [APPLE], repoConfigs: { [APPLE]: null }, items: [projectIssue(1, 'Queued', APPLE)] };
  const board = await startBoard(t, options, false, true);
  await until(board, (d) => !!d.repositoryConfigProblems?.length);
  await board.update({ ...options, repoConfigs: { [APPLE]: { role: 'Apple client', itemSource: LAR } } });
  const data = await until(board, (d) => d.items.length === 1);
  assert.deepEqual([data.repositoryConfigProblems, data.repos.map((r) => r.repo)], [[], [APPLE]]);
});

test("the config update notice's Dismiss refuses a repository off this Mac's list", async (t) => {
  const board = await startBoard(t, { repositories: [FACTORY], items: [projectIssue(1, 'Queued', FACTORY)] });
  await until(board, (d) => d.fetchedAt !== null);
  const response = await board.post({ repo: APPLE }, board.url, '/api/repositories/config-update/dismiss');
  assert.deepEqual([response.status, await response.json()], [409, { error: `${APPLE} is not on this Mac's list.` }]);
});

test("Edit's Save shows the Edit PR on the repository's row at once", async (t) => {
  const board = await startBoard(t, { repositories: [FACTORY], items: [projectIssue(1, 'Queued', FACTORY)], files: ['.lar-factory.json'] });
  await until(board, (d) => d.fetchedAt !== null);
  const config = { itemSource: { kind: 'issues' }, show: 'all', role: 'The factory', labels: [] };
  const response = await board.post({ repo: FACTORY, config }, board.url, '/api/repositories/config/pr');
  const { prUrl, board: data } = await response.json() as { prUrl: string; board: BoardData };
  assert.equal(response.status, 200);
  assert.match(prUrl, /\/pull\/\d+$/);
  assert.equal(data.repos.find((r) => r.repo === FACTORY)?.editPr, prUrl);
});
