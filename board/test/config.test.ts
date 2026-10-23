import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadConfig } from '../src/config.ts';

const server = { repo: 'maddec01/mux-server', platform: 'Server', path: '~/code/mux-server', role: 'Backend API server' };

async function configWith(t: TestContext, repos: unknown[]): Promise<URL> {
  const dir = await mkdtemp(join(tmpdir(), 'mux config test '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'config.json');
  await writeFile(file, JSON.stringify({ project: { owner: 'maddec01', title: 'Mux' }, repos }));
  return pathToFileURL(file);
}

test('a repository entry keeps its checkout path and role', async (t) => {
  assert.deepEqual(loadConfig(await configWith(t, [server])).repos, [server]);
});

test('a repository entry without a checkout path or role is refused, naming the repo and field', async (t) => {
  const { path: _path, ...noPath } = server;
  const { role: _role, ...noRole } = server;
  await assert.rejects(async () => loadConfig(await configWith(t, [noPath])), /maddec01\/mux-server.*"path"/);
  await assert.rejects(async () => loadConfig(await configWith(t, [noRole])), /maddec01\/mux-server.*"role"/);
  await assert.rejects(async () => loadConfig(await configWith(t, [{ ...server, role: ' ' }])), /maddec01\/mux-server.*"role"/);
});

test('a checkout path outside ~/ is refused, because config.json is public', async (t) => {
  for (const path of ['/Users/someone/mux-server', 'mux-server', '~', '~someone/mux-server']) {
    await assert.rejects(async () => loadConfig(await configWith(t, [{ ...server, path }])),
      /maddec01\/mux-server.*"path".*~\//, path);
  }
});

test('the factory config gives every repository a ~/ checkout path and a role', () => {
  for (const repo of loadConfig().repos) {
    assert.match(repo.path, /^~\//, repo.repo);
    assert.ok(repo.role.trim(), repo.repo);
  }
});
