import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, readdir, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { checkouts, factoryRepo } from './repo-support.ts';
import { projectsDb } from './stats-db.ts';
import { freePort, rawIssue, startBoard } from './server-support.ts';
import type { TestContext } from 'node:test';
import type { BoardData, UpdateProgress } from '../src/model.ts';

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
// install.sh: \`npx --yes skills add <repo> -g -a claude-code codex -s <names> -y\`, laid out like the skills CLI.
if (command === 'npx' && args[1] === 'skills' && args[2] === 'add') {
  if (process.env.SKILLS_DELAY) cp.execFileSync('sleep', [process.env.SKILLS_DELAY]);
  const names = args.slice(args.indexOf('-s') + 1, args.lastIndexOf('-y'));
  for (const name of names) {
    const dir = path.join(process.env.HOME, '.agents/skills', name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'See \`../../references/checklist.md\`.\\n');
    fs.mkdirSync(path.join(process.env.HOME, '.claude/skills'), { recursive: true });
    try { fs.symlinkSync('../../.agents/skills/' + name, path.join(process.env.HOME, '.claude/skills', name)); } catch {}
  }
}
// install.sh lists references/ on GitHub main, then fetches each file.
if (command === 'gh' && args[0] === 'api') {
  const url = args.find((a) => a.startsWith('repos/'));
  process.stdout.write(url.includes('references/checklist.md') ? 'checklist from main\\n' : 'checklist.md\\n');
}
// pnpm install lays out node_modules with its .modules.yaml marker.
if (command === 'pnpm' && args[0] === 'install') {
  fs.mkdirSync('node_modules', { recursive: true });
  fs.writeFileSync('node_modules/.modules.yaml', 'layoutVersion: 5\\n');
}
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
  for (const name of ['pnpm', 'npx', 'launchctl', 'plutil', 'gh']) await symlink(fake, join(bin, name));
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
    const inherited: NodeJS.ProcessEnv = { ...f.env };
    delete inherited.BOARD_PORT;
    const child = spawn('bash', [join(f.repo, 'board/scripts/update.sh')], { env: { ...inherited, HOME: home,
      PATH: `${bin}:${process.env.PATH}`, UPDATE_CALLS: calls, UPDATE_HEALTH: health, UPDATE_REPO: f.repo, ...env } });
    let output = '';
    child.stdout.on('data', (v: Buffer) => { output += v.toString(); });
    child.stderr.on('data', (v: Buffer) => { output += v.toString(); });
    child.on('exit', (code) => resolve({ code, output }));
  });
  const progress = async () => JSON.parse(await readFile(join(home, 'Library/Application Support/mux-factory-board/update.json'), 'utf8')) as UpdateProgress;
  return { ...f, home, health, run, progress, commandEnv: { HOME: home, PATH: `${bin}:${process.env.PATH}`, UPDATE_CALLS: calls, UPDATE_HEALTH: health, UPDATE_REPO: f.repo }, calls: async () => (await readFile(calls, 'utf8')).trim().split('\n').filter(Boolean).map((v) => JSON.parse(v) as string[]) };
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
  for (const [command, message] of [['pnpm', /failed at install/], ['launchctl', /failed at restart/], ['npx', /failed at skills/]] as const) {
    const f = await updateFixture(t);
    const result = await f.run({ FAIL_STEP: command });
    assert.notEqual(result.code, 0);
    assert.match(result.output, message);
    assert.doesNotMatch(result.output, /Update complete/);
    const calls = await f.calls();
    if (command === 'pnpm') assert.ok(!calls.some((c) => c[0] === 'launchctl'));
    if (command !== 'npx') assert.ok(!calls.some((c) => c[0] === 'npx'));
  }
  const f = await updateFixture(t);
  f.git('remote', 'set-url', 'origin', join(f.dir, 'missing-origin'));
  assert.match((await f.run()).output, /failed at fetch/);
  assert.deepEqual(await f.calls(), []);
});

test('launchctl success followed by crash, old responder or wrong revision cannot complete an update', async (t) => {
  await Promise.all(['dead', 'stale', 'wrong-revision'].map(async (mode) => {
    const f = await updateFixture(t);
    await writeFile(f.health, JSON.stringify({ runningRevision: f.git('rev-parse', 'HEAD'), launchToken: 'previous-run' }));
    f.git('commit', '--allow-empty', '-m', 'feat(board): merged update');
    f.git('push', 'origin', 'HEAD:main');
    f.git('reset', '--hard', 'HEAD~1');
    const result = await f.run({ STARTUP_MODE: mode });
    assert.notEqual(result.code, 0, mode);
    assert.match(result.output, /failed at health/);
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

test('updater fast-forwards, reinstalls, waits for the new revision, installs skills, and a rerun skips the restart', async (t) => {
  const f = await updateFixture(t);
  const before = f.git('rev-parse', 'HEAD');
  f.git('switch', '-c', 'remote-work');
  f.git('commit', '--allow-empty', '-m', 'feat(board): merged update');
  const remote = f.git('rev-parse', 'HEAD');
  f.git('push', 'origin', 'HEAD:main');
  f.git('switch', 'main');
  assert.equal(f.git('rev-parse', 'HEAD'), before);
  const steps: string[][] = [];
  for (let i = 0; i < 2; i++) {
    const result = await f.run();
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Update complete/);
    assert.equal(f.git('rev-parse', 'HEAD'), remote);
    const progress = await f.progress();
    assert.equal(progress.state, 'done');
    assert.equal(progress.revision, remote);
    steps.push(progress.finished);
  }
  assert.deepEqual(steps, [
    ['check', 'fetch', 'install', 'restart', 'health', 'skills', 'profiles', 'done'],
    ['check', 'fetch', 'skills', 'profiles', 'done'],
  ]);
  const calls = await f.calls();
  assert.deepEqual(calls.filter((c) => c[0] === 'pnpm'), [['pnpm', 'install', '--frozen-lockfile']]);
  assert.equal(calls.filter((c) => c[0] === 'launchctl' && c[1] === 'bootstrap').length, 1);
  assert.equal(calls.filter((c) => c[0] === 'npx' && c[2] === 'skills' && c[3] === 'add').length, 2);
});

/** Puts origin/main one commit ahead, so the next run installs. */
function behindMain(f: Awaited<ReturnType<typeof updateFixture>>) {
  f.git('commit', '--allow-empty', '-m', 'feat(board): merged update');
  f.git('push', 'origin', 'HEAD:main');
  f.git('reset', '--hard', 'HEAD~1');
}

test('the install step replaces an npm-made node_modules and keeps a pnpm-made one', async (t) => {
  for (const pnpmMade of [false, true]) {
    const f = await updateFixture(t);
    behindMain(f);
    const modules = join(f.repo, 'board/node_modules');
    await mkdir(modules);
    await writeFile(join(modules, 'marker'), 'old');
    if (pnpmMade) await writeFile(join(modules, '.modules.yaml'), 'layoutVersion: 5\n');
    const result = await f.run();
    assert.equal(result.code, 0, result.output);
    assert.equal(existsSync(join(modules, 'marker')), pnpmMade);
    assert.ok(existsSync(join(modules, '.modules.yaml')));
  }
});

test('a missing pnpm fails the install step with the brew hint', async (t) => {
  const f = await updateFixture(t);
  behindMain(f);
  const bin = join(f.dir, 'bin');
  await rm(join(bin, 'pnpm'));
  const nodeBin = join(f.dir, 'node-bin');
  await mkdir(nodeBin);
  await symlink(process.execPath, join(nodeBin, 'node'));
  const result = await f.run({ PATH: `${bin}:${nodeBin}:/usr/bin:/bin` });
  assert.notEqual(result.code, 0);
  assert.match(result.output, /failed at install: pnpm not found on PATH/);
  assert.match((await f.progress()).error!, /brew install pnpm/);
  assert.ok(!(await f.calls()).some((c) => c[0] === 'launchctl'));
});

test('the skills step installs every listed skill and replaces the checklists with main\'s', async (t) => {
  const f = await updateFixture(t);
  const listed = execFileSync('bash', ['-c', 'source "$1"; printf "%s\\n" "${SKILLS[@]}"', '_', join(f.repo, 'scripts/install.sh')], { encoding: 'utf8' }).trim().split('\n');
  for (const folder of ['.agents/references', '.claude/references']) {
    await mkdir(join(f.home, folder), { recursive: true });
    await writeFile(join(f.home, folder, 'removed-upstream.md'), 'old');
  }
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  const add = (await f.calls()).find((c) => c[0] === 'npx' && c[3] === 'add')!;
  assert.deepEqual(add.slice(add.indexOf('-s') + 1, add.lastIndexOf('-y')), listed);
  for (const name of listed) await readFile(join(f.home, '.agents/skills', name, 'SKILL.md'));
  for (const folder of ['.agents/references', '.claude/references']) {
    assert.deepEqual(await readdir(join(f.home, folder)), ['checklist.md']);
    assert.equal(await readFile(join(f.home, folder, 'checklist.md'), 'utf8'), 'checklist from main\n');
  }
});

test('a failed update records the step, its message and the log tail', async (t) => {
  const f = await updateFixture(t);
  await writeFile(join(f.repo, 'local.txt'), 'dirty');
  assert.notEqual((await f.run()).code, 0);
  const progress = await f.progress();
  assert.equal(progress.state, 'failed');
  assert.equal(progress.current, 'check');
  assert.deepEqual(progress.finished, []);
  assert.match(progress.error!, /local changes/);
  assert.match(progress.logTail!, /Update failed at check/);
  assert.ok(progress.finishedAt);
});

test('one lock covers every update; a lock left by a dead process is cleared', async (t) => {
  const f = await updateFixture(t);
  const lock = join(f.home, 'Library/Application Support/mux-factory-board/update.lock');
  await mkdir(dirname(lock), { recursive: true });
  const holder = spawn('sleep', ['30']);
  t.after(() => holder.kill());
  await writeFile(lock, String(holder.pid));
  const busy = await f.run();
  assert.notEqual(busy.code, 0);
  assert.match(busy.output, /already running/);
  assert.deepEqual(await f.calls(), []);
  assert.equal(await readFile(lock, 'utf8'), String(holder.pid));
  holder.kill();
  await once(holder, 'exit');
  const result = await f.run();
  assert.equal(result.code, 0, result.output);
  await assert.rejects(readFile(lock), 'the lock is released after the update');
});

/** A launch-agent board (token, configured port) serving the fixture checkout, with the fake commands on PATH. */
async function launchAgentBoard(t: TestContext, options: object = {}, env: Record<string, string> = {}) {
  const f = await updateFixture(t);
  const port = await freePort();
  const config = JSON.parse(await readFile(join(f.repo, 'config.json'), 'utf8'));
  config.board.port = port;
  await writeFile(join(f.repo, 'config.json'), JSON.stringify(config));
  f.git('commit', '-am', 'chore(board): use the board port');
  f.git('push', 'origin', 'main');
  const board = await startBoard(t, options, false, false,
    { ...f.commandEnv, BOARD_PORT: String(port), BOARD_LAUNCH_TOKEN: 'launch-1', ...env }, join(f.repo, 'board'));
  const update = () => board.post({}, board.url, '/api/update');
  // The first GitHub read can finish after the board starts answering.
  for (let i = 0; i < 80 && (await board.board() as BoardData).items.length < ((options as { items?: unknown[] }).items?.length ?? 0); i++) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const settled = async () => {
    for (let i = 0; i < 200; i++) {
      const data = await board.board() as BoardData;
      if (data.update && data.update.state !== 'running') return data.update;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail('The update did not finish');
  };
  return { ...f, board, update, settled };
}

test('Update on the launch-agent board runs the updater apart from the board and reports each step', async (t) => {
  const f = await launchAgentBoard(t);
  assert.equal((await f.board.board() as BoardData).codeUpdate?.updatable, true);
  assert.equal((await f.board.post({}, 'https://evil.example', '/api/update')).status, 403);
  const response = await f.update();
  assert.equal(response.status, 202);
  const started = await response.json() as { error: string | null; board: BoardData };
  assert.equal(started.error, null);
  assert.ok(started.board.update, 'the answer carries the new update');
  const done = await f.settled();
  assert.equal(done.state, 'done', done.error ?? '');
  assert.deepEqual(done.finished, ['check', 'fetch', 'skills', 'profiles', 'done'], 'a board already on origin/main only updates skills');
  const calls = await f.calls();
  assert.ok(calls.some((c) => c[0] === 'npx' && c[3] === 'add'));
  assert.ok(!calls.some((c) => c[0] === 'pnpm' || c[0] === 'launchctl'));
  assert.equal(f.git('status', '--porcelain'), '', 'the update leaves the checkout clean');
});

test('Update is refused while another update runs, and Start waits for it', async (t) => {
  const f = await launchAgentBoard(t, { items: [rawIssue(12, 'Queued')] }, { SKILLS_DELAY: '2' });
  assert.equal((await f.update()).status, 202);
  const again = await f.update();
  assert.equal(again.status, 409);
  assert.match((await again.json()).error, /already running/);
  const terminal = await f.run();
  assert.notEqual(terminal.code, 0);
  assert.match(terminal.output, /already running/);
  const { capture } = await f.board.board() as BoardData;
  const start = await f.board.post({ session: capture!.session, itemId: 'PVTI_12' }, f.board.url, '/api/start');
  assert.equal(start.status, 409);
  assert.match((await start.json()).error, /updating/);
  assert.equal((await f.settled()).state, 'done');
  assert.equal((await f.update()).status, 202, 'the next update can start once this one finished');
  await f.settled();
});

test('Update is refused while a Start runs', async (t) => {
  const f = await launchAgentBoard(t, { items: [rawIssue(12, 'Queued')], t3: { delay: 1000 } },
    { T3_STATE_DB: projectsDb(t, [{ id: 'project-factory', root: '~/Developer/Mux/mux-factory' }]) });
  checkouts(f.home, { 'mux-factory': 'https://github.com/maddec01/mux-factory.git' });
  const { capture } = await f.board.board() as BoardData;
  const start = f.board.post({ session: capture!.session, itemId: 'PVTI_12' }, f.board.url, '/api/start');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const refused = await f.update();
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /Start is running/);
  assert.equal((await start).status, 200);
  assert.equal((await f.update()).status, 202);
  await f.settled();
});

test('dev runs, other ports and sample mode do not offer Update', async (t) => {
  const f = await updateFixture(t);
  const boards = [
    await startBoard(t, {}, false, false, f.commandEnv, join(f.repo, 'board')),
    await startBoard(t, {}, false, false, { ...f.commandEnv, BOARD_LAUNCH_TOKEN: 'launch-1' }, join(f.repo, 'board')),
    await startBoard(t, {}, false, false, { ...f.commandEnv, BOARD_LAUNCH_TOKEN: 'launch-1', BOARD_DATA_FILE: join(f.repo, 'sample.json') }, join(f.repo, 'board')),
  ];
  for (const board of boards) {
    assert.equal((await board.board() as BoardData).codeUpdate?.updatable, false);
    const response = await board.post({}, board.url, '/api/update');
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /update\.sh/);
  }
  assert.deepEqual(await f.calls(), []);
});
