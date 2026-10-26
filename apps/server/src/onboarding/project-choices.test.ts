import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
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

/** A gh that answers each repository's .lar-factory.json read: a file, a 404, or a failure. */
const gh = (files: Record<string, 'file' | 'none' | 'fails'>) => async (args: string[]) => {
  const repo = args[1]!.match(/^repos\/(.+)\/contents\/\.lar-factory\.json$/)![1]!;
  if (files[repo] === 'file') return '{"role":"x"}';
  throw new Error(files[repo] === 'none' ? 'gh: Not Found (HTTP 404)' : 'HTTP 502: Bad Gateway');
};

test('each T3 project shows its provider, whether its repository has .lar-factory.json, and whether it is on the board', async (t) => {
  const { home, env } = t3Home(t, {
    'lar-web': 'git@github.com:maddec01/lar-web.git',
    'lar-server': 'https://github.com/maddec01/lar-server.git',
    'lar-api': 'https://contoso@dev.azure.com/contoso/Fabrikam/_git/lar-api',
    'lar-cli': 'https://github.com/maddec01/lar-cli',
  });
  const choices = await projectChoices([{ repo: 'Maddec01/lar-server' }], env,
    gh({ 'maddec01/lar-web': 'file', 'maddec01/lar-server': 'none', 'maddec01/lar-cli': 'fails' }));
  const folder = (name: string) => join(home, 'Developer/lar', name);
  assert.deepEqual(choices, [
    { id: 'lar-web', name: 'lar-web', folder: folder('lar-web'), repo: 'maddec01/lar-web', provider: 'GitHub', hasConfig: true, onBoard: false },
    { id: 'lar-server', name: 'lar-server', folder: folder('lar-server'), repo: 'maddec01/lar-server', provider: 'GitHub', hasConfig: false, onBoard: true },
    // Reading an Azure DevOps repository's file waits for build #386.
    { id: 'lar-api', name: 'lar-api', folder: folder('lar-api'), repo: 'Fabrikam/lar-api', provider: 'Azure DevOps', hasConfig: null, onBoard: false },
    { id: 'lar-cli', name: 'lar-cli', folder: folder('lar-cli'), repo: 'maddec01/lar-cli', provider: 'GitHub', hasConfig: null, onBoard: false },
  ]);
});

test('a project with no origin, another host or a worktree folder names no repository', async (t) => {
  const { home, env } = t3Home(t, { bare: null, gitlab: 'git@gitlab.com:someone/thing.git' });
  mkdirSync(join(home, 'Developer/lar/plain'), { recursive: true });
  const db = projectsDb(t, ['bare', 'gitlab', 'plain'].map((name) => ({ id: name, root: join(home, 'Developer/lar', name) })));
  const choices = await projectChoices([], { ...env, T3_STATE_DB: db }, gh({}));
  assert.deepEqual(choices.map((c) => [c.name, c.repo, c.provider, c.hasConfig]), [['bare', null, null, null], ['gitlab', null, null, null], ['plain', null, null, null]]);
});

test("T3's projects that can't be read are an error that names the database", async () => {
  await assert.rejects(projectChoices([], { ...process.env, T3_STATE_DB: '/nowhere/state.sqlite' }, gh({})), /Can't read T3 Code's projects at \/nowhere\/state\.sqlite/);
});
