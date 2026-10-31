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

test('each repository reads its locally selected list source and settings without config file reads', async (t) => {
  const board = await startBoard(t, { repositories: [FACTORY, APPLE],
    localSetups: { [FACTORY]: { role: 'Factory', itemSource: LAR }, [APPLE]: { role: 'Apple', itemSource: LAR, labels: ['app: music'] } },
    repoIssues: { [APPLE]: [appleIssue(7, ['status-queued'])] }, items: [boardIssue(1, 'Queued', FACTORY)] });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.equal(data.error, null);
  assert.deepEqual(data.repos.map(({ setup: _, ...row }) => row), [
    { repo: FACTORY, role: 'Factory', items: 'issues', labels: [] }, { repo: APPLE, role: 'Apple', items: 'issues', labels: ['app: music'] },
  ]);
  assert.equal(await configReads(board), 0);
});

test('without onboarded repositories the board is empty', async (t) => {
  const board = await startBoard(t, { repositories: null, items: [boardIssue(1, 'Queued', FACTORY)] });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual([data.items, data.repos, data.error], [[], [], null]);
  assert.equal(await projectReads(board), 0);
});

test('a malformed local list stops the read and clears repository rows', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'broken-local-list-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'Library/Application Support/Lar Factory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'repository-settings.json'), '{ broken');
  const board = await startBoard(t, {}, false, false, { HOME: home });
  const data = await until(board, (d) => d.error !== null);
  assert.equal(data.error, `${join(dir, 'repository-settings.json')} isn't valid JSON.`);
  assert.deepEqual(data.repos, []);
});

test('local changes show immediately without setup acceptance or a repository PR', async (t) => {
  const board = await startBoard(t, { repositories: [FACTORY], items: [boardIssue(1, 'Queued', FACTORY)] }, false, true);
  await until(board, (d) => d.items.length === 1);
  const response = await board.post({ repo: FACTORY, change: 'override', key: 'role', value: 'My factory' }, board.url, '/api/repositories/settings');
  const { board: data } = await response.json() as { board: BoardData };
  assert.equal(response.status, 200);
  assert.equal(data.repos[0]?.setup?.role, 'My factory');
  const docs = await board.post({ repo: FACTORY, change: 'override', key: 'domainDocs', value: { kind: 'repository', glossary: 'GLOSSARY.md', adrs: 'docs/adr' } }, board.url, '/api/repositories/settings');
  assert.equal(docs.status, 200);
  assert.ok(!(await board.board()).items[0]?.paused);
  assert.equal(await configReads(board), 0);
});
