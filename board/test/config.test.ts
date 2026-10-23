import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_URL, loadConfig } from '../src/config.ts';

const server = { repo: 'maddec01/mux-server', platform: 'Server', role: 'Backend API server' };

async function configWith(t: TestContext, repos: unknown[], extra: object = {}): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), 'mux config test '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ project: { owner: 'maddec01', title: 'Mux' }, repos, ...extra }));
  return pathToFileURL(file);
}

test('a repository entry keeps its role', async (t) => {
  assert.deepEqual(loadConfig(await configWith(t, [server])).repos, [server]);
});

test('an older entry with a checkout path still loads, with the path ignored', async (t) => {
  assert.deepEqual(loadConfig(await configWith(t, [{ ...server, path: '/anywhere' }])).repos, [server]);
});

test('a repository entry without a role is refused, naming the repo', async (t) => {
  const { role: _role, ...noRole } = server;
  await assert.rejects(async () => loadConfig(await configWith(t, [noRole])), /maddec01\/mux-server.*"role"/);
  await assert.rejects(async () => loadConfig(await configWith(t, [{ ...server, role: ' ' }])), /maddec01\/mux-server.*"role"/);
});

test('the factory config gives every repository a role and no checkout path', () => {
  for (const repo of loadConfig().repos) assert.ok(repo.role.trim(), repo.repo);
  const shipped = JSON.parse(readFileSync(CONFIG_URL, 'utf8')) as { repos: object[] };
  for (const repo of shipped.repos) assert.equal('path' in repo, false, JSON.stringify(repo));
});

test('an older config with board.port still loads, with the port ignored', async (t) => {
  const config = loadConfig(await configWith(t, [server], { board: { port: 4400, refreshSeconds: 30 } }));
  assert.equal(config.refreshSeconds, 30);
  assert.equal('port' in config, false);
  assert.equal('configuredPort' in config, false);
});

test('the factory config names no board port', () => {
  const shipped = JSON.parse(readFileSync(CONFIG_URL, 'utf8')) as { board?: object };
  assert.equal('port' in (shipped.board ?? {}), false);
});
