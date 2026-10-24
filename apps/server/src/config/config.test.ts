import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG_URL, configUrl, loadConfig } from './config.ts';

const server = { repo: 'maddec01/mux-server', platform: 'Server', role: 'Backend API server' };

async function configWith(t: TestContext, repos: unknown[], extra: object = {}): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), 'mux config test '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
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

test('BOARD_CONFIG_FILE names the config file in place of the checkout\'s; unset or empty, the checkout\'s is read', async (t) => {
  const elsewhere = await configWith(t, [server], { project: { owner: 'someone', title: 'Elsewhere' } });
  const config = loadConfig(configUrl({ BOARD_CONFIG_FILE: fileURLToPath(elsewhere) }));
  assert.equal(config.owner, 'someone');
  assert.equal(config.title, 'Elsewhere');
  assert.deepEqual(config.repos, [server]);
  assert.equal(configUrl({}).href, CONFIG_URL.href);
  assert.equal(configUrl({ BOARD_CONFIG_FILE: '' }).href, CONFIG_URL.href);
});

test('a BOARD_CONFIG_FILE that doesn\'t exist is refused, naming the path', () => {
  const missing = join(tmpdir(), 'no such dir', 'config.json');
  assert.throws(() => loadConfig(configUrl({ BOARD_CONFIG_FILE: missing })),
    (err: Error) => err.message.includes(missing) && /no config file/.test(err.message));
});
