import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoardData, SetupDetection } from '@lar-factory/shared';
import { fakeAzRepos } from '../src/azure/fake-az.ts';
import { detectReads, detectSetup } from '../src/onboarding/detect-setup.ts';
import { checkouts } from './repo-support.ts';
import { shapePrompt, larWork, startBoard, until, writesRepository } from './server-support.ts';
import { projectsDb } from './stats-db.ts';
import { AZURE_WITH_PROJECT_RULES, NO_FACTORY_FILES } from './workflow-fixtures.ts';

test('a repository with no factory files onboards, captures work and starts it with no write to the repository', { timeout: 30_000 }, async (t) => {
  const { repo, origin, files } = NO_FACTORY_FILES;
  const home = mkdtempSync(join(tmpdir(), 'lar-boundary-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  checkouts(home, { 'lar-web': origin });
  const dir = join(home, 'Library/Application Support/Lar Factory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'repository-settings.json'), JSON.stringify({ repositories: [
    { repo, onboarding: { step: 'setup', done: ['project'], answers: { projectId: 'lar-web' } } }] }));
  const db = projectsDb(t, [{ id: 'lar-web', root: `${home}/Developer/lar/lar-web` }]);
  const board = await startBoard(t, { files, localSetups: { [repo]: null }, recorded: false }, false, true, { HOME: home, T3_STATE_DB: db });

  const { detection } = await (await board.post({ repo, projectId: 'lar-web' }, board.url, '/api/onboarding/detect')).json() as { detection: SetupDetection };
  assert.deepEqual([detection.domainDocs, detection.projectSkills],
    [{ found: { kind: 'off' } }, { found: [] }]);
  const saved = await board.post({ repo, projectId: 'lar-web', role: 'Web client', itemSource: { kind: 'issues' }, domainDocs: { kind: 'off' },
    structureSync: false, skills: [] }, board.url, '/api/onboarding/setup');
  assert.equal(saved.status, 200);

  const created = await larWork(board.dataDir, 'create', '--title', 'Dark mode', '--repository', repo, '--kind', 'feature', '--status', 'Queued');
  await until(board, (d) => d.items.some((i) => i.id === created.workId && i.status === 'Queued'));
  const started = await board.postSession({ itemId: created.workId }, '/api/start');
  assert.equal(started.status, 200);
  const [start] = (await board.t3Calls()).filter((args) => args[1] === 'start');
  assert.deepEqual(start, ['thread', 'start', 'lar-web', shapePrompt(board,'Dark mode',created.workId), '--json']);
  assert.equal((await board.board() as BoardData).items.find((i) => i.id === created.workId)?.status, 'Queued', 'a start moves no Status');
  assert.deepEqual((await board.calls()).filter(writesRepository), []);
});

test('an Azure DevOps repository with its own guidance, with existing project rules, detects its project skill without reading or writing guidance, writing nothing', async () => {
  const az = fakeAzRepos({ files: AZURE_WITH_PROJECT_RULES.files });
  const answer = await detectSetup({ repo: AZURE_WITH_PROJECT_RULES.repo, projectId: AZURE_WITH_PROJECT_RULES.checkout.id },
    { ...detectReads(az.run), checkouts: async () => [AZURE_WITH_PROJECT_RULES.checkout], teams: async () => ['Example App Team'] });
  const { detection } = answer as { detection: SetupDetection };
  assert.deepEqual([detection.provider, detection.checkout, detection.itemSources],
    ['Azure DevOps', { found: '/Users/me/Developer/Example App' }, { found: [{ kind: 'azure-board', team: 'Example App Team' }] }]);
  assert.deepEqual([detection.domainDocs, detection.projectSkills], [{ found: { kind: 'off' } }, { found: ['example-app-review'] }]);
  assert.ok(!('factoryFiles' in detection));
  assert.ok(!('sharedConfig' in detection));
  assert.deepEqual([az.pushes, az.prs, az.comments], [[], [], []]);
});
