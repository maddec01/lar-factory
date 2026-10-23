import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { testEnv } from './repo-support.ts';

/** A copy of board/ with its real dependencies, and fake launchctl, plutil and gh that log their calls. */
async function launchFixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'mux-launch-agent-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const board = join(dir, 'board');
  for (const entry of ['src', 'scripts', 'launchd', 'index.html', 'vite.config.ts', 'package.json']) {
    await cp(new URL(`../${entry}`, import.meta.url), join(board, entry), { recursive: true });
  }
  await symlink(new URL('../node_modules', import.meta.url).pathname, join(board, 'node_modules'));
  await writeFile(join(dir, 'config.json'), '{"board":{"port":4999}}');
  const bin = join(dir, 'bin');
  const calls = join(dir, 'calls');
  await mkdir(bin);
  await writeFile(calls, '');
  const fake = join(bin, 'fake.cjs');
  await writeFile(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync(process.env.LAUNCH_CALLS, JSON.stringify([path.basename(process.argv[1]), ...process.argv.slice(2)]) + '\\n');
if (path.basename(process.argv[1]) === 'launchctl' && process.argv[2] === 'print') process.exit(1);
`);
  await chmod(fake, 0o755);
  for (const name of ['launchctl', 'plutil', 'gh']) await symlink(fake, join(bin, name));
  const home = join(dir, 'home');
  await mkdir(home);
  const run = () => new Promise<{ code: number | null; output: string }>((resolve) => {
    const child = spawn('bash', [join(board, 'scripts/install-launch-agent.sh')], {
      env: { ...testEnv(), HOME: home, PATH: `${bin}:${process.env.PATH}`, LAUNCH_CALLS: calls, BOARD_LAUNCH_TOKEN: 'launch-1' },
    });
    let output = '';
    child.stdout.on('data', (v: Buffer) => { output += v.toString(); });
    child.stderr.on('data', (v: Buffer) => { output += v.toString(); });
    child.on('exit', (code) => resolve({ code, output }));
  });
  const commands = async () => (await readFile(calls, 'utf8')).trim().split('\n').filter(Boolean).map((v) => (JSON.parse(v) as string[]).slice(0, 2).join(' '));
  return { board, home, run, commands };
}

test('install-launch-agent.sh builds the page, then replaces the running board', async (t) => {
  const f = await launchFixture(t);
  const { code, output } = await f.run();
  assert.equal(code, 0, output);
  assert.ok(existsSync(join(f.board, 'dist/index.html')));
  assert.deepEqual((await f.commands()).filter((c) => c.startsWith('launchctl')),
    ['launchctl bootout', 'launchctl print', 'launchctl bootstrap', 'launchctl kickstart']);
});

test('a failing build stops install-launch-agent.sh before it stops the running board', async (t) => {
  const f = await launchFixture(t);
  await writeFile(join(f.board, 'src/main.tsx'), "import './missing.ts';\n");
  const { code, output } = await f.run();
  assert.notEqual(code, 0);
  assert.match(output, /the board page did not build; the running board was left as it was/);
  assert.deepEqual((await f.commands()).filter((c) => c.startsWith('launchctl')), []);
  assert.ok(!existsSync(join(f.home, 'Library/LaunchAgents/nl.mux.factory-board.plist')), 'the old plist stays');
});
