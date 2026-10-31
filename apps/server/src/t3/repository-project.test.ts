import { liveProjects } from './t3-db.ts';
import { vi, test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vite-plus/test';
import { anyOnAzureDevOps, azureRepo, onAzureDevOps, repositoryProjectHints } from './repository-project.ts';
import { checkouts } from '../../test/repo-support.ts';
import { projectsDb } from '../../test/stats-db.ts';

const AZURE = [
  'https://contoso@dev.azure.com/contoso/Fabrikam/_git/lar-api',
  'git@ssh.dev.azure.com:v3/contoso/Fabrikam/lar-api',
  'https://contoso.visualstudio.com/Fabrikam/_git/lar-api',
  'contoso@vs-ssh.visualstudio.com:v3/contoso/Fabrikam/lar-api',
];
const GITHUB = ['https://github.com/maddec01/lar-factory.git', 'git@github.com:maddec01/lar-factory.git', 'ssh://git@github.com/maddec01/lar-factory'];

test('an origin on dev.azure.com or *.visualstudio.com is on Azure DevOps, and a GitHub one is not', () => {
  for (const url of AZURE) assert.equal(onAzureDevOps(url), true, url);
  for (const url of [...GITHUB, 'https://github.com/dev.azure.com/lar', 'https://visualstudio.com.example.com/x/y']) assert.equal(onAzureDevOps(url), false, url);
});

/** A home with checkouts of these origins under ~/Developer/lar, each a T3 project, and the env that reads them. */
function t3Home(t: TestContext, origins: Record<string, string>): NodeJS.ProcessEnv {
  const home = mkdtempSync(join(tmpdir(), 'lar-azure-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  checkouts(home, origins);
  const db = projectsDb(t, Object.keys(origins).map((name) => ({ id: name, root: join(home, 'Developer/lar', name) })));
  return { ...process.env, HOME: home, T3_STATE_DB: db };
}

test('a listed repository on Azure DevOps needs az; GitHub ones and unlisted Azure checkouts do not', async (t) => {
  const env = t3Home(t, { 'lar-factory': GITHUB[0]!, 'lar-api': AZURE[0]! });
  const repo = (name: string) => ({ repo: name, role: 'server' });
  assert.equal(await anyOnAzureDevOps([repo('maddec01/lar-factory')], env), false);
  assert.equal(await anyOnAzureDevOps([repo('maddec01/lar-factory'), repo('Contoso/fabrikam/lar-api')], env), true);
  assert.equal(await anyOnAzureDevOps([repo('maddec01/lar-factory'), repo('other/Fabrikam/lar-api')], env), false);
  assert.equal(await anyOnAzureDevOps([repo('maddec01/lar-factory')], { ...env, T3_STATE_DB: '/nowhere/state.sqlite' }), false);
});

test('every Azure DevOps origin form names its organization, project and repository', () => {
  for (const url of AZURE) assert.equal(azureRepo(url), 'contoso/Fabrikam/lar-api', url);
  assert.equal(azureRepo('https://dev.azure.com/contoso/Fabrikam/_git/lar-api'), 'contoso/Fabrikam/lar-api');
  assert.equal(azureRepo('https://contoso.visualstudio.com/DefaultCollection/Fabrikam/_git/lar-api'), 'contoso/Fabrikam/lar-api');
  assert.equal(azureRepo('https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/lar%20api'), 'contoso/Fabrikam%20Fiber/lar%20api');
  // A repository named after its project may leave the project out.
  assert.equal(azureRepo('https://dev.azure.com/contoso/_git/Fabrikam'), 'contoso/Fabrikam/Fabrikam');
  for (const url of [...GITHUB, 'https://dev.azure.com/contoso', 'https://dev.azure.com/contoso/Fabrikam/_wiki/x']) assert.equal(azureRepo(url), null, url);
});

test('Start finds the checkout of a GitHub or an Azure DevOps repository', async (t) => {
  const env = t3Home(t, { 'lar-factory': GITHUB[0]!, 'lar-api': AZURE[0]! });
  const repo = (name: string) => ({ repo: name, role: 'server', labels: [] });
  assert.deepEqual(await repositoryProjectHints([repo('maddec01/lar-factory'), repo('contoso/fabrikam/lar-api'), repo('contoso/fabrikam/lar-web')], env), {
    'maddec01/lar-factory': null,
    'contoso/fabrikam/lar-api': null,
    'contoso/fabrikam/lar-web': 'No T3 project is a checkout of contoso/fabrikam/lar-web; add the checkout in T3 Code',
  });
});

vi.mock('./repository-project-discovery.ts', () => ({ repositoryProjects: async (env: NodeJS.ProcessEnv) => {
  try { return { availability: 'available', observation: { observedAt: '2026-10-31T00:00:00Z', projects: liveProjects(env.T3_STATE_DB!, env.HOME ?? '').map(p => ({ id: p.id, title: p.title, workspaceRoot: p.folder })) } }; }
  catch { return { availability: 'unavailable' }; }
} }));
