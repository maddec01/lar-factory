import { liveProjects } from '../t3/t3-db.ts';
import { vi, test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vite-plus/test';
import type { ProjectIcon } from '@lar-factory/shared';
import { projectChoices } from './project-choices.ts';
import { checkouts } from '../../test/repo-support.ts';
import { projectsDb } from '../../test/stats-db.ts';

/** A home with checkouts of these origins under ~/Developer/lar, each a T3 project, and the env that reads them. */
function t3Home(t: TestContext, origins: Record<string, string | null>): { home: string; env: NodeJS.ProcessEnv } {
  const home = mkdtempSync(join(tmpdir(), 'lar-choices-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  checkouts(home, origins);
  const db = projectsDb(t, Object.keys(origins).map((name) => ({ id: name, root: join(home, 'Developer/lar', name) })));
  return { home, env: { ...process.env, HOME: home, T3_STATE_DB: db } };
}

test('projects come from checkout origins without reading repository settings', async (t) => {
  const { env } = t3Home(t, { app: 'git@github.com:team/app.git', server: 'https://dev.azure.com/org/project/_git/server' });
  const projects = await projectChoices([{ repo: 'TEAM/app' }], new Map(), env);
  assert.deepEqual(projects.map(({ id, repo, provider, onBoard }) => ({ id, repo, provider, onBoard })), [
    { id: 'app', repo: 'team/app', provider: 'GitHub', onBoard: true },
    { id: 'server', repo: 'org/project/server', provider: 'Azure DevOps', onBoard: false },
  ]);
  assert.ok(projects.every((project) => !('hasConfig' in project)));
});

test('each folder without a repository says why, and a folder under the home shows it as ~', async (t) => {
  const { home, env } = t3Home(t, { valid: 'git@github.com:team/valid.git', worktree: null, submodule: null, nested: null, 'no-origin': null, 'no-git': null, 'other-host': 'git@gitlab.com:team/app.git' });
  const folder = (name: string) => join(home, 'Developer/lar', name);
  const dotGit = (name: string, text: string) => { rmSync(join(folder(name), '.git'), { recursive: true }); writeFileSync(join(folder(name), '.git'), text); };
  dotGit('worktree', 'gitdir: /Users/me/app/.git/worktrees/worktree\n');
  dotGit('submodule', 'gitdir: ../../.git/modules/submodule\n');
  // A submodule of a checkout under a folder named worktrees, or of a linked worktree, is still a submodule.
  dotGit('nested', 'gitdir: /Users/me/worktrees/app/.git/worktrees/one/modules/nested\n');
  rmSync(join(folder('no-git'), '.git'), { recursive: true });
  const projects = await projectChoices([], new Map(), env);
  assert.deepEqual(Object.fromEntries(projects.map(({ id, blocked }) => [id, blocked])), {
    valid: null, worktree: 'linked-worktree', submodule: 'no-provider-origin', nested: 'no-provider-origin',
    'no-origin': 'no-provider-origin', 'no-git': 'no-provider-origin', 'other-host': 'no-provider-origin',
  });
  const valid = projects.find(({ id }) => id === 'valid')!;
  assert.deepEqual([valid.shownFolder, valid.folder], ['~/Developer/lar/valid', folder('valid')]);
});

test("each project takes its icon by ID, whether it's on the board, off it or has no repository, and one with none has null", async (t) => {
  const { env } = t3Home(t, { listed: 'git@github.com:team/listed.git', 'off-board': 'git@github.com:team/off-board.git', 'no-origin': null, plain: 'git@github.com:team/plain.git' });
  const icons = new Map<string, ProjectIcon>([
    ['listed', { kind: 'emoji', emoji: '🚀' }],
    ['off-board', { kind: 'favicon', projectId: 'off-board', revision: 'abc' }],
    ['no-origin', { kind: 'monogram', text: 'NO', color: 'rose' }],
  ]);
  const projects = await projectChoices([{ repo: 'team/listed' }], icons, env);
  assert.deepEqual(Object.fromEntries(projects.map(({ id, icon }) => [id, icon])), {
    listed: { kind: 'emoji', emoji: '🚀' },
    'off-board': { kind: 'favicon', projectId: 'off-board', revision: 'abc' },
    'no-origin': { kind: 'monogram', text: 'NO', color: 'rose' },
    plain: null,
  });
});

vi.mock('../t3/repository-project-discovery.ts', () => ({ repositoryProjects: async (env: NodeJS.ProcessEnv) => {
  try { return { availability: 'available', observation: { observedAt: '2026-10-31T00:00:00Z', projects: liveProjects(env.T3_STATE_DB!, env.HOME ?? '').map(p => ({ id: p.id, title: p.title, workspaceRoot: p.folder, faviconPath: null, projectIcon: null })) } }; }
  catch { return { availability: 'unavailable' }; }
} }));
