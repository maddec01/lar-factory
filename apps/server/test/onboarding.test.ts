import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkouts } from './repo-support.ts';
import { startBoard } from './server-support.ts';
import { projectsDb } from './stats-db.ts';

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
