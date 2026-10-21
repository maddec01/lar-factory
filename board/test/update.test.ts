import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { factoryRepo } from './repo-support.ts';
import type { TestContext } from 'node:test';

async function updateFixture(t: TestContext) {
  const f = await factoryRepo(t);
  const home = join(f.dir, 'home');
  await mkdir(home);
  const bin = join(f.dir, 'bin');
  const calls = join(f.dir, 'calls');
  const health = join(f.dir, 'health');
  await mkdir(bin);
  await writeFile(calls, '');
  const fake = join(bin, 'fake.cjs');
  await writeFile(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
fs.appendFileSync(process.env.UPDATE_CALLS, JSON.stringify([command, ...args]) + '\\n');
if (process.env.FAIL_STEP === command) process.exit(1);
if (command === 'launchctl' && args[0] === 'print') process.exit(1);
if (command === 'launchctl' && args[0] === 'bootstrap') {
  const plist = fs.readFileSync(args[2], 'utf8');
  const launchToken = plist.match(/<key>BOARD_LAUNCH_TOKEN<\\/key>\\s*<string>([^<]*)/)[1];
  const runningRevision = cp.execFileSync('git', ['rev-parse', 'HEAD'], {cwd: process.env.UPDATE_REPO, encoding: 'utf8'}).trim();
  if (process.env.STARTUP_MODE === 'dead') { try { fs.unlinkSync(process.env.UPDATE_HEALTH); } catch {} }
  else if (process.env.STARTUP_MODE !== 'stale') fs.writeFileSync(process.env.UPDATE_HEALTH,
    JSON.stringify({runningRevision: process.env.STARTUP_MODE === 'wrong-revision' ? 'old' : runningRevision, launchToken}));
}
`);
  await chmod(fake, 0o755);
  for (const name of ['npm', 'npx', 'launchctl', 'plutil', 'gh']) await symlink(fake, join(bin, name));
  const server = createServer(async (_req, res) => {
    try { res.end(await readFile(health)); }
    catch { res.writeHead(503); res.end(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = (server.address() as { port: number }).port;
  const config = JSON.parse(await readFile(join(f.repo, 'config.json'), 'utf8'));
  config.board.port = port;
  await writeFile(join(f.repo, 'config.json'), JSON.stringify(config));
  f.git('add', '.');
  f.git('commit', '-m', 'chore(board): set isolated port');
  f.git('push', 'origin', 'main');
  const run = (env = {}) => new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn('bash', [join(f.repo, 'board/scripts/update.sh')], { env: { ...f.env, HOME: home,
      PATH: `${bin}:${process.env.PATH}`, UPDATE_CALLS: calls, UPDATE_HEALTH: health, UPDATE_REPO: f.repo, ...env } });
    let output = '';
    child.stdout.on('data', (v: Buffer) => { output += v.toString(); });
    child.stderr.on('data', (v: Buffer) => { output += v.toString(); });
    child.on('exit', (code) => resolve({ code, output }));
  });
  return { ...f, home, health, run, calls: async () => (await readFile(calls, 'utf8')).trim().split('\n').filter(Boolean).map((v) => JSON.parse(v) as string[]) };
}

test('updater refuses a non-main branch before invoking any install commands', async (t) => {
  const f = await updateFixture(t);
  f.git('switch', '-c', 'work');
  const { code, output } = await f.run();
  assert.notEqual(code, 0);
  assert.match(output, /main/);
  assert.doesNotMatch(output, /Update complete/);
  assert.deepEqual(await f.calls(), []);
  f.git('switch', '--detach');
  const detached = await f.run();
  assert.notEqual(detached.code, 0);
  assert.match(detached.output, /main/);
  assert.deepEqual(await f.calls(), []);
});

test('updater reports the failed step and stops before later changes', async (t) => {
  for (const [command, message] of [['npm', /install board dependencies/], ['launchctl', /refresh and restart/], ['npx', /update global skills/]] as const) {
    const f = await updateFixture(t);
    const result = await f.run({ FAIL_STEP: command });
    assert.notEqual(result.code, 0);
    assert.match(result.output, message);
    assert.doesNotMatch(result.output, /Update complete/);
    const calls = await f.calls();
    if (command === 'npm') assert.ok(!calls.some((c) => c[0] === 'launchctl'));
    if (command !== 'npx') assert.ok(!calls.some((c) => c[0] === 'npx'));
  }
  const f = await updateFixture(t);
  f.git('remote', 'set-url', 'origin', join(f.dir, 'missing-origin'));
  assert.match((await f.run()).output, /failed at fetch origin\/main/);
  assert.deepEqual(await f.calls(), []);
});

test('launchctl success followed by crash, old responder or wrong revision cannot complete an update', async (t) => {
  await Promise.all(['dead', 'stale', 'wrong-revision'].map(async (mode) => {
    const f = await updateFixture(t);
    await writeFile(f.health, JSON.stringify({ runningRevision: f.git('rev-parse', 'HEAD'), launchToken: 'previous-run' }));
    const result = await f.run({ STARTUP_MODE: mode });
    assert.notEqual(result.code, 0, mode);
    assert.match(result.output, /failed at confirm board readiness/);
    assert.doesNotMatch(result.output, /Update complete/);
    const calls = await f.calls();
    assert.ok(calls.some((c) => c[0] === 'launchctl' && c[1] === 'kickstart'));
    assert.ok(!calls.some((c) => c[0] === 'npx'));
  }));
});

test('extra Claude profiles receive eligible relative skill links; conflicts survive and mean partial failure', async (t) => {
  const f = await updateFixture(t);
  const source = join(f.home, '.agents/skills');
  const claude = join(f.home, '.claude/skills');
  const profile = join(f.home, '.claude-personal/skills');
  for (const path of [source, claude, profile, join(f.home, '.claude-work')]) await mkdir(path, { recursive: true });
  for (const name of ['mux-work', 'new-skill', 'file-conflict', 'link-conflict', 'uninstalled']) await mkdir(join(source, name));
  for (const name of ['mux-work', 'new-skill', 'file-conflict', 'link-conflict']) {
    await symlink(`../../.agents/skills/${name}`, join(claude, name));
  }
  await mkdir(join(f.home, 'unrelated'));
  await symlink('../../unrelated', join(claude, 'other'));
  await writeFile(join(claude, 'real-file'), 'keep');
  await symlink('../../.agents/skills/mux-work', join(profile, 'mux-work'));
  await writeFile(join(profile, 'file-conflict'), 'precious');
  await symlink('missing-unrelated', join(profile, 'link-conflict'));
  for (let i = 0; i < 2; i++) {
    const result = await f.run();
    assert.notEqual(result.code, 0);
    assert.match(result.output, /partial update/i);
    assert.ok(result.output.includes(join(profile, 'file-conflict')));
    assert.ok(result.output.includes(join(profile, 'link-conflict')));
    assert.doesNotMatch(result.output, /Update complete/);
    assert.equal(await readlink(join(profile, 'new-skill')), '../../.agents/skills/new-skill');
    assert.equal(await readlink(join(f.home, '.claude-work/skills/file-conflict')), '../../.agents/skills/file-conflict');
    assert.equal(await readFile(join(profile, 'file-conflict'), 'utf8'), 'precious');
    assert.equal(await readlink(join(profile, 'link-conflict')), 'missing-unrelated');
    await assert.rejects(readlink(join(profile, 'uninstalled')));
    await assert.rejects(readlink(join(profile, 'other')));
    await assert.rejects(readlink(join(profile, 'real-file')));
  }
});

test('synchronization handles no profiles and preserves an unrelated skills-directory link', async (t) => {
  const f = await updateFixture(t);
  await mkdir(join(f.home, '.agents/skills/mux-work'), { recursive: true });
  await mkdir(join(f.home, '.claude/skills'), { recursive: true });
  await symlink('../../.agents/skills/mux-work', join(f.home, '.claude/skills/mux-work'));
  assert.equal((await f.run()).code, 0, 'no extra profiles is harmless');
  await mkdir(join(f.home, '.claude-blocked'));
  await mkdir(join(f.home, 'unrelated'));
  await symlink('../unrelated', join(f.home, '.claude-blocked/skills'));
  const result = await f.run();
  assert.notEqual(result.code, 0);
  assert.match(result.output, /partial update/i);
  assert.equal(await readlink(join(f.home, '.claude-blocked/skills')), '../unrelated');
  await assert.rejects(readlink(join(f.home, 'unrelated/mux-work')));
});

test('updater refuses untracked, staged and unstaged changes without changing HEAD', async (t) => {
  const f = await updateFixture(t);
  const head = f.git('rev-parse', 'HEAD');
  for (const kind of ['untracked', 'staged', 'unstaged']) {
    await writeFile(join(f.repo, 'local.txt'), kind);
    if (kind !== 'untracked') f.git('add', 'local.txt');
    if (kind === 'unstaged') {
      f.git('commit', '-m', 'chore(board): keep local file');
      await writeFile(join(f.repo, 'local.txt'), 'changed');
    }
    const before = f.git('rev-parse', 'HEAD');
    const result = await f.run();
    assert.notEqual(result.code, 0, kind);
    assert.match(result.output, /local changes/i);
    assert.equal(f.git('rev-parse', 'HEAD'), before);
    if (kind === 'untracked') f.git('add', 'local.txt');
    if (kind !== 'unstaged') f.git('commit', '-m', 'chore(board): keep local file');
  }
  assert.notEqual(f.git('rev-parse', 'HEAD'), head);
  assert.deepEqual(await f.calls(), []);
});

test('updater preserves clean local-ahead and diverged commits', async (t) => {
  const f = await updateFixture(t);
  const base = f.git('rev-parse', 'HEAD');
  f.git('commit', '--allow-empty', '-m', 'chore(board): local work');
  const head = f.git('rev-parse', 'HEAD');
  let result = await f.run();
  assert.notEqual(result.code, 0);
  assert.match(result.output, /ahead|fast-forward/i);
  assert.equal(f.git('rev-parse', 'HEAD'), head);
  f.git('switch', '-c', 'remote-work', base);
  f.git('commit', '--allow-empty', '-m', 'chore(board): remote work');
  f.git('push', 'origin', 'HEAD:main');
  f.git('switch', 'main');
  result = await f.run();
  assert.notEqual(result.code, 0);
  assert.match(result.output, /diverged|fast-forward/i);
  assert.equal(f.git('rev-parse', 'HEAD'), head);
  assert.deepEqual(await f.calls(), []);
});

test('updater fast-forwards, reinstalls, waits for the new revision, updates skills and can rerun', async (t) => {
  const f = await updateFixture(t);
  const before = f.git('rev-parse', 'HEAD');
  f.git('switch', '-c', 'remote-work');
  f.git('commit', '--allow-empty', '-m', 'feat(board): merged update');
  const remote = f.git('rev-parse', 'HEAD');
  f.git('push', 'origin', 'HEAD:main');
  f.git('switch', 'main');
  assert.equal(f.git('rev-parse', 'HEAD'), before);
  for (let i = 0; i < 2; i++) {
    const result = await f.run();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Update complete/);
    assert.equal(f.git('rev-parse', 'HEAD'), remote);
  }
  const calls = await f.calls();
  assert.equal(calls.filter((c) => c[0] === 'npm' && c[1] === 'ci').length, 2);
  assert.equal(calls.filter((c) => c[0] === 'launchctl' && c[1] === 'bootstrap').length, 2);
  assert.equal(calls.filter((c) => c[0] === 'npx' && c.slice(1).join(' ') === 'skills update -g').length, 2);
});
