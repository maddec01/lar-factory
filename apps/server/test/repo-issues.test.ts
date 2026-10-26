import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoardData } from '@lar-factory/shared';
import { projectIssue, sliceRef } from '@lar-factory/shared/test/raw-items';
import { startBoard, until } from './server-support.ts';

const APPLE = 'maddec01/lar-apple';
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/** A lar-apple issue as the repository issues query returns it. */
const appleIssue = (number: number, extra: object = {}) => ({ ...projectIssue(number, 'List', APPLE).content!, ...extra });

/** The checkout's config.json with lar-apple reading its issues. */
async function issuesConfig(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar-issues-config-'));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  const config = JSON.parse(await readFile(new URL('../../../config.json', import.meta.url), 'utf8')) as { repos: { repo: string }[] };
  for (const entry of config.repos) if (entry.repo === APPLE) Object.assign(entry, { items: 'issues' });
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify(config));
  return file;
}

test("a repository reading its issues shows the open ones as List and those closed this week as Done, without slices; the Project's copy wins", async (t) => {
  const build = appleIssue(8, { labels: { nodes: [{ name: 'build' }] }, subIssues: { nodes: [{ ...sliceRef(11, 'OPEN'), repository: { nameWithOwner: APPLE },
    url: `https://github.com/${APPLE}/issues/11` }] } });
  const repoIssues = { [APPLE]: [
    appleIssue(7), build, appleIssue(11),
    appleIssue(9, { state: 'CLOSED', stateReason: 'COMPLETED', closedAt: daysAgo(2), updatedAt: daysAgo(2) }),
    appleIssue(10, { state: 'CLOSED', stateReason: 'COMPLETED', closedAt: daysAgo(10), updatedAt: daysAgo(1) }),
    appleIssue(12, { state: 'CLOSED', stateReason: 'COMPLETED', closedAt: daysAgo(20), updatedAt: daysAgo(20) }),
  ] };
  const board = await startBoard(t, { items: [projectIssue(1, 'In progress', 'maddec01/lar-server'), projectIssue(7, 'Queued', APPLE)], repoIssues },
    false, false, { BOARD_CONFIG_FILE: await issuesConfig(t) });
  const data = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(data.items.map((i) => [i.repo, i.number, i.status]),
    [['maddec01/lar-server', 1, 'In progress'], [APPLE, 7, 'Queued'], [APPLE, 8, 'List'], [APPLE, 9, 'Done']]);
  assert.equal(data.project.title, 'lar');
  assert.ok(!(await board.calls()).some((args) => args.some((a) => a.includes('repository(owner:')) && args.includes('name=lar-server')),
    'a repository on the Project reads no issues');
});

test("a write on an item from a repository's issues is refused and reaches no Project", async (t) => {
  const board = await startBoard(t, { items: [], repoIssues: { [APPLE]: [appleIssue(8)] } }, false, false, { BOARD_CONFIG_FILE: await issuesConfig(t) });
  await until(board, (d) => d.items.length === 1);
  const response = await board.post({ itemId: 'I_8' }, board.url, '/api/queue');
  assert.equal(response.status, 502);
  assert.match((await response.json() as { error: string }).error, /can't change maddec01\/lar-apple's items yet/);
  assert.equal((await board.board() as BoardData).items[0]!.status, 'List');
  assert.ok(!(await board.calls()).some((args) => args[0] === 'project'), 'no Project command ran');
});
