import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vite-plus/test';
import { createConfigChecks } from './config-checks.ts';
import { onboardingOffers, projectChoices } from './project-choices.ts';
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

/** A gh that answers each repository's .lar-factory.json read: a file, a wrong file, a 404, or a failure. */
const gh = (files: Record<string, 'file' | 'wrong' | 'none' | 'fails'>) => createConfigChecks(async (args: string[]) => {
  const repo = args[1]!.match(/^repos\/(.+)\/contents\/\.lar-factory\.json$/)![1]!;
  if (files[repo] === 'file') return '{"role":"Web client","itemSource":{"kind":"github-project","owner":"maddec01","number":3}}';
  if (files[repo] === 'wrong') return '{"itemSource":{"kind":"issues"}}';
  throw new Error(files[repo] === 'none' ? 'gh: Not Found (HTTP 404)' : 'HTTP 502: Bad Gateway');
}, () => {}).configOf;

test('each T3 project shows its provider, whether its repository has .lar-factory.json with its values, and whether it is on the board', async (t) => {
  const { home, env } = t3Home(t, {
    'lar-web': 'git@github.com:maddec01/lar-web.git',
    'lar-server': 'https://github.com/maddec01/lar-server.git',
    'lar-api': 'https://contoso@dev.azure.com/contoso/Fabrikam/_git/lar-api',
    'lar-cli': 'https://github.com/maddec01/lar-cli',
  });
  const choices = await projectChoices([{ repo: 'Maddec01/lar-server' }],
    gh({ 'maddec01/lar-web': 'file', 'maddec01/lar-server': 'none', 'maddec01/lar-cli': 'fails' }), env);
  const folder = (name: string) => join(home, 'Developer/lar', name);
  assert.deepEqual(choices, [
    { id: 'lar-web', name: 'lar-web', folder: folder('lar-web'), repo: 'maddec01/lar-web', provider: 'GitHub', hasConfig: true, onBoard: false,
      config: { itemSource: { kind: 'github-project', owner: 'maddec01', number: 3 }, show: 'all', role: 'Web client' } },
    { id: 'lar-server', name: 'lar-server', folder: folder('lar-server'), repo: 'maddec01/lar-server', provider: 'GitHub', hasConfig: false, onBoard: true },
    // Reading an Azure DevOps repository's file waits for build #386.
    { id: 'lar-api', name: 'lar-api', folder: folder('lar-api'), repo: 'Fabrikam/lar-api', provider: 'Azure DevOps', hasConfig: null, onBoard: false },
    { id: 'lar-cli', name: 'lar-cli', folder: folder('lar-cli'), repo: 'maddec01/lar-cli', provider: 'GitHub', hasConfig: null, onBoard: false },
  ]);
});

test("a .lar-factory.json that is wrong carries its problem in place of its values", async (t) => {
  const { env } = t3Home(t, { 'lar-web': 'git@github.com:maddec01/lar-web.git' });
  const [choice] = await projectChoices([], gh({ 'maddec01/lar-web': 'wrong' }), env);
  assert.equal(choice!.hasConfig, true);
  assert.equal(choice!.config, undefined);
  assert.equal(choice!.configProblem, '.lar-factory.json field role is missing or not a string.');
});

test('a project with no origin, another host or a worktree folder names no repository', async (t) => {
  const { home, env } = t3Home(t, { bare: null, gitlab: 'git@gitlab.com:someone/thing.git' });
  mkdirSync(join(home, 'Developer/lar/plain'), { recursive: true });
  const db = projectsDb(t, ['bare', 'gitlab', 'plain'].map((name) => ({ id: name, root: join(home, 'Developer/lar', name) })));
  const choices = await projectChoices([], gh({}), { ...env, T3_STATE_DB: db });
  assert.deepEqual(choices.map((c) => [c.name, c.repo, c.provider, c.hasConfig]), [['bare', null, null, null], ['gitlab', null, null, null], ['plain', null, null, null]]);
});

test("T3's projects that can't be read are an error that names the database", async () => {
  await assert.rejects(projectChoices([], gh({}), { ...process.env, T3_STATE_DB: '/nowhere/state.sqlite' }), /Can't read T3 Code's projects at \/nowhere\/state\.sqlite/);
});

test('the board offers each T3 project whose GitHub repository has .lar-factory.json and is off the list', () => {
  const choice = (name: string, parts: object) => ({ id: name, name, folder: `/f/${name}`, repo: `maddec01/${name}`,
    provider: 'GitHub' as const, hasConfig: true, onBoard: false, ...parts });
  const offers = onboardingOffers([
    choice('lar-web', {}),
    choice('lar-server', { onBoard: true }),
    choice('lar-cli', { hasConfig: false }),
    // A check that failed offers nothing.
    choice('lar-docs', { hasConfig: null }),
    choice('lar-api', { provider: 'Azure DevOps', repo: 'Fabrikam/lar-api' }),
    choice('plain', { provider: null, repo: null }),
  ]);
  assert.deepEqual(offers, [{ projectId: 'lar-web', name: 'lar-web', repo: 'maddec01/lar-web' }]);
});
