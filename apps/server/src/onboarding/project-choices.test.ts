import { liveProjects } from '../t3/t3-db.ts';
import { vi, test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vite-plus/test';
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
  const projects = await projectChoices([{ repo: 'TEAM/app' }], env);
  assert.deepEqual(projects.map(({ id, repo, provider, onBoard }) => ({ id, repo, provider, onBoard })), [
    { id: 'app', repo: 'team/app', provider: 'GitHub', onBoard: true },
    { id: 'server', repo: 'org/project/server', provider: 'Azure DevOps', onBoard: false },
  ]);
  assert.ok(projects.every((project) => !('hasConfig' in project)));
});

vi.mock('../t3/repository-project-discovery.ts', () => ({ repositoryProjects: async (env: NodeJS.ProcessEnv) => {
  try { return { availability: 'available', observation: { observedAt: '2026-10-31T00:00:00Z', projects: liveProjects(env.T3_STATE_DB!, env.HOME ?? '').map(p => ({ id: p.id, title: p.title, workspaceRoot: p.folder })) } }; }
  catch { return { availability: 'unavailable' }; }
} }));
