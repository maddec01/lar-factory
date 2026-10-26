import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vite-plus/test';
import { anyOnAzureDevOps, onAzureDevOps, repositoryProjectHints } from './repository-project.ts';
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
  const repo = (name: string) => ({ repo: name, role: 'server', platform: 'Server' });
  assert.equal(await anyOnAzureDevOps([repo('maddec01/lar-factory')], env), false);
  assert.equal(await anyOnAzureDevOps([repo('maddec01/lar-factory'), repo('fabrikam/lar-api')], env), true);
  assert.equal(await anyOnAzureDevOps([repo('maddec01/lar-factory')], { ...env, T3_STATE_DB: '/nowhere/state.sqlite' }), false);
});

test('every Azure DevOps origin form names its project/repo', async (t) => {
  for (const url of AZURE) {
    const env = t3Home(t, { 'lar-api': url });
    assert.equal(await anyOnAzureDevOps([{ repo: 'fabrikam/lar-api', role: 'server', platform: 'Server' }], env), true, url);
  }
});

test('Start build finds only GitHub checkouts; Azure DevOps naming waits for build #386', async (t) => {
  const env = t3Home(t, { 'lar-factory': GITHUB[0]!, 'lar-api': AZURE[0]! });
  const repo = (name: string) => ({ repo: name, role: 'server', platform: 'Server' });
  assert.deepEqual(await repositoryProjectHints([repo('maddec01/lar-factory'), repo('Fabrikam/lar-api')], env), {
    'maddec01/lar-factory': null,
    'Fabrikam/lar-api': 'No T3 project is a checkout of Fabrikam/lar-api; add the checkout in T3 Code',
  });
});
