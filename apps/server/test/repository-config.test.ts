import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoardData } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';

const APPLE = 'maddec01/lar-apple';
const FACTORY = 'maddec01/lar-factory';
const LAR = { kind: 'issues' };

const appleIssue = (number: number, labels: string[] = []) =>
  ({ ...boardIssue(number, 'List', APPLE).content!, labels: { nodes: labels.map((name) => ({ name })) } });

const projectReads = async (board: Board) => (await board.calls()).filter((args) => args.some((a) => a.includes('states: [OPEN]'))).length;
const configReads = async (board: Board) => (await board.calls()).filter((args) => args[1]?.endsWith('/.lar-factory.json')).length;

test('each onboarded repository reads its items from the item source its .lar-factory.json names and lists its settings', async (t) => {
  const board = await startBoard(t, {
    repositories: [FACTORY, APPLE],
    repoConfigs: { [FACTORY]: { version: 1, role: 'The factory', itemSource: LAR, labels: [] },
      [APPLE]: { role: 'Apple client', itemSource: { kind: 'issues' }, show: 'opted-in', labels: ['app: music'] } },
    items: [boardIssue(1, 'Queued', FACTORY), boardIssue(2, 'List', FACTORY)],
    repoIssues: { [APPLE]: [appleIssue(7, ['status-queued'])] },
  });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.equal(data.error, null);
  assert.deepEqual(data.items.map((i) => [i.repo, i.number, i.status]), [[FACTORY, 1, 'Queued'], [APPLE, 7, 'Queued'], [FACTORY, 2, 'List']], 'Queued work comes first, in Queue order');
  assert.deepEqual(data.repos.map(({ setup: _, ...row }) => row), [{ repo: FACTORY, role: 'The factory', items: 'issues', labels: [], version: 1, configUpdate: 2 },
    { repo: APPLE, role: 'Apple client', items: 'issues', labels: ['app: music'], version: 2 }]);
});

test('without a list of onboarded repositories the board is empty', async (t) => {
  const board = await startBoard(t, { repositories: null, items: [boardIssue(1, 'Queued', FACTORY)] });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual([data.items, data.repos, data.error], [[], [], null]);
  assert.equal(await projectReads(board), 0);
});

test("a list that isn't valid JSON stops the read with the board's read error, naming the file", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-broken-list-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'Library/Application Support/Lar Factory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'repository-settings.json'), '{ broken');
  const board = await startBoard(t, { items: [boardIssue(1, 'Queued', FACTORY)] }, false, false, { HOME: home });
  const data = await until(board, (d) => d.error !== null);
  assert.equal(data.error, `${join(dir, 'repository-settings.json')} isn't valid JSON.`);
  assert.deepEqual(data.items, []);
});

test("the old settings.json neither sets the refresh interval nor fails the board", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-old-settings-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'Library/Application Support/Lar Factory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'settings.json'), '{ broken');
  const board = await startBoard(t, { repositories: [FACTORY], repoConfigs: { [FACTORY]: { role: 'The factory', itemSource: LAR } },
    items: [boardIssue(1, 'Queued', FACTORY)] }, false, false, { HOME: home });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.equal(data.error, null);
  assert.equal(data.refreshSeconds, 300);
  assert.deepEqual(data.items.map((i) => i.number), [1]);
});

test("a list that stops being valid JSON clears the repositories and notices of the last read", async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-list-breaks-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const options = { repositories: [FACTORY, APPLE], repoConfigs: { [FACTORY]: { role: 'The factory', itemSource: LAR }, [APPLE]: '{ broken' },
    items: [boardIssue(1, 'Queued', FACTORY)] };
  const board = await startBoard(t, options, false, true, { HOME: home });
  await until(board, (d) => d.repos.length === 2 && !!d.repositoryConfigProblems?.length);
  writeFileSync(join(home, 'Library/Application Support/Lar Factory/repository-settings.json'), '{ broken');
  const data = await until(board, (d) => d.error !== null);
  assert.deepEqual([data.repos, data.repositoryConfigProblems], [[], []]);
});

test('a change to a .lar-factory.json shows on the next refresh, and the board still shows only recorded work', async (t) => {
  const options = { repositories: [APPLE], repoConfigs: { [APPLE]: { role: 'Apple client', itemSource: LAR } },
    repoIssues: { [APPLE]: [appleIssue(7)] }, recorded: false };
  const board = await startBoard(t, options, false, true);
  await until(board, (d) => d.repos[0]?.role === 'Apple client');
  await board.update({ ...options, repoConfigs: { [APPLE]: { role: 'Apple app', itemSource: { kind: 'issues' } } } });
  const data: BoardData = await until(board, (d) => d.repos[0]?.role === 'Apple app');
  assert.deepEqual(data.items, [], 'an issue with no work record stays off the board');
  assert.deepEqual(data.repos.map(({ setup: _, ...row }) => row), [{ repo: APPLE, role: 'Apple app', items: 'issues', labels: [], version: 2 }]);
});

test('a repository without a .lar-factory.json is on the board from its local settings', async (t) => {
  const board = await startBoard(t, { repositories: [FACTORY, APPLE], repoConfigs: { [FACTORY]: { role: 'The factory', itemSource: LAR }, [APPLE]: null },
    items: [boardIssue(1, 'Queued', FACTORY), boardIssue(2, 'Queued', APPLE)], repoIssues: { [APPLE]: [appleIssue(7, ['status-queued'])] } });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.equal(data.error, null);
  assert.deepEqual(data.repos.map((r) => [r.repo, r.role]), [[FACTORY, 'The factory'], [APPLE, '']]);
  assert.deepEqual(data.repositoryConfigProblems, []);
});

test("a .lar-factory.json that doesn't parse or has a wrong field keeps the last usable setup with a notice, which clears once it reads", async (t) => {
  const problems = { '{ broken': ".lar-factory.json isn't valid JSON.", wrong: '.lar-factory.json field itemSource must be {"kind": "issues"}.' };
  for (const [name, config] of [['{ broken', '{ broken'], ['wrong', { role: 'Apple client', itemSource: { kind: 'sprint' } }]] as const) {
    const options = { repositories: [APPLE], repoConfigs: { [APPLE]: { role: 'Apple client', itemSource: LAR } as unknown }, items: [boardIssue(1, 'Queued', APPLE)] };
    const board = await startBoard(t, options, false, true);
    await until(board, (d) => d.repos[0]?.role === 'Apple client');
    await board.update({ ...options, repoConfigs: { [APPLE]: config } });
    const data = await until(board, (d) => !!d.repositoryConfigProblems?.length);
    assert.deepEqual(data.repositoryConfigProblems, [{ repo: APPLE, kind: 'shared-config', problem: problems[name] }], name);
    assert.deepEqual(data.repos.map((r) => [r.repo, r.role]), [[APPLE, 'Apple client']], name);
    await board.update(options);
    await until(board, (d) => d.repositoryConfigProblems?.length === 0);
  }
});

test("the config update notice's Dismiss refuses a repository off this Mac's list", async (t) => {
  const board = await startBoard(t, { repositories: [FACTORY], items: [boardIssue(1, 'Queued', FACTORY)] });
  await until(board, (d) => d.fetchedAt !== null);
  const response = await board.post({ repo: APPLE }, board.url, '/api/repositories/config-update/dismiss');
  assert.deepEqual([response.status, await response.json()], [409, { error: `${APPLE} is not on this Mac's list.` }]);
});

test("a local override shows on the repository's row at once, and a shared domain-doc change pauses work until accepted", async (t) => {
  const options = { repositories: [FACTORY], repoConfigs: { [FACTORY]: { role: 'The factory', itemSource: LAR } as unknown }, items: [boardIssue(1, 'Queued', FACTORY)] };
  const board = await startBoard(t, options, false, true);
  await until(board, (d) => d.items.length === 1);
  const response = await board.post({ repo: FACTORY, change: 'override', key: 'role', value: 'My factory' }, board.url, '/api/repositories/settings');
  const { board: data } = await response.json() as { board: BoardData };
  assert.equal(response.status, 200);
  assert.deepEqual([data.repos[0]?.setup?.role, data.repos[0]?.setup?.sources.role], ['My factory', 'local']);
  await board.update({ ...options, repoConfigs: { [FACTORY]: { role: 'The factory', itemSource: LAR, domainDocs: { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' } } } });
  const paused = await until(board, (d) => !!d.items[0]?.paused);
  assert.deepEqual(paused.repos[0]?.setup?.paused, ['domainDocs']);
  await board.post({ repo: FACTORY, change: 'accept' }, board.url, '/api/repositories/settings');
  await until(board, (d) => d.items.length === 1 && !d.items[0]!.paused);
});
