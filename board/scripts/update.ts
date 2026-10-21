// Updates the checkout that holds this script: main, board dependencies, the
// launch agent, then the skills through scripts/install.sh and extra Claude profiles.
// The board's Update button starts it detached, because the restart step kills the board.
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { loadConfig } from '../src/config.ts';
import { acquireLock, releaseLock, updatePaths, writeProgress } from '../src/update-state.ts';
import type { UpdateProgress, UpdateStep } from '../src/model.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const board = fileURLToPath(new URL('../', import.meta.url));
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30_000 }).trim();
const paths = updatePaths();

async function health(port: number): Promise<{ runningRevision?: string; launchToken?: string } | null> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(750), redirect: 'error' });
    return response.ok ? await response.json() as { runningRevision?: string; launchToken?: string } : null;
  } catch { return null; }
}

async function waitForBoard(port: number, revision: string, launchToken: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    // A successful launchctl call may still be followed by a crash or bind failure.
    const answer = await health(port);
    if (answer?.runningRevision === revision && answer.launchToken === launchToken) return;
    await setTimeout(250);
  }
  throw new Error(`The expected board revision ${revision} did not become ready on port ${port}. Check ${paths.boardLog} and the port, then rerun.`);
}

if (!acquireLock(paths)) {
  const message = 'An update is already running. Wait for it to finish, then retry.';
  console.error(message);
  process.exitCode = 1;
  // Exit once the board has the message; a terminal run has no channel.
  await new Promise((resolve) => process.send ? process.send({ busy: message }, resolve) : resolve(null));
  process.exit();
}

mkdirSync(dirname(paths.log), { recursive: true });
const log = createWriteStream(paths.log);
const say = (line: string) => { log.write(`${line}\n`); console.log(line); };

/** Runs a command, copying its output to the log and to this process's output. */
function run(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv }): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    for (const stream of [child.stdout, child.stderr]) {
      stream.on('data', (chunk: Buffer) => { log.write(chunk); process.stdout.write(chunk); });
    }
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`)));
  });
}

const progress: UpdateProgress = {
  state: 'running', pid: process.pid, finished: [], current: 'check',
  startedAt: new Date().toISOString(), finishedAt: null, revision: null, error: null, logTail: null,
};
writeProgress(paths, progress);
process.send?.({ started: true });
process.disconnect?.();

function begin(step: UpdateStep): void {
  if (progress.current && progress.current !== step) progress.finished.push(progress.current);
  progress.current = step;
  writeProgress(paths, progress);
  say(step);
}

try {
  begin('check');
  if (git('branch', '--show-current') !== 'main') throw new Error('Switch this checkout to main before updating.');
  if (git('status', '--porcelain')) throw new Error('Commit or stash local changes (including untracked files), then rerun.');
  begin('fetch');
  git('fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main');
  const local = git('rev-parse', 'HEAD');
  const remote = git('rev-parse', 'origin/main');
  progress.revision = remote;
  if (git('rev-list', '--count', `${remote}..${local}`) !== '0') {
    throw new Error('Local main is ahead of or diverged from origin/main. Preserve and reconcile your commits manually, then rerun; only equal or fast-forward updates are allowed.');
  }
  git('merge', '--ff-only', remote);
  const port = loadConfig().port;
  // Already on origin/main: only the skills can be behind.
  if (local !== remote || (await health(port))?.runningRevision !== remote) {
    begin('install');
    await run('npm', ['ci'], { cwd: board });
    begin('restart');
    const launchToken = randomUUID();
    await run('bash', [fileURLToPath(new URL('./install-launch-agent.sh', import.meta.url))], {
      cwd: board, env: { ...process.env, BOARD_LAUNCH_TOKEN: launchToken },
    });
    begin('health');
    await waitForBoard(port, remote, launchToken);
  }
  begin('skills');
  await run('bash', [fileURLToPath(new URL('../../scripts/install.sh', import.meta.url))], { cwd: root });
  begin('profiles');
  await run(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('./sync-claude-skills.ts', import.meta.url))], { cwd: root });
  begin('done');
  progress.finished.push('done');
  progress.current = null;
  progress.state = 'done';
  say(`Update complete: board ${remote} is running, skills and checklists are installed and extra Claude profiles are synchronized.`);
} catch (error) {
  progress.state = 'failed';
  progress.error = (error as Error).message;
  log.write(`Update failed at ${progress.current}: ${progress.error}\n`);
  console.error(`Update failed at ${progress.current}: ${progress.error}`);
  process.exitCode = 1;
} finally {
  await new Promise((resolve) => log.end(resolve));
  if (progress.state === 'failed') progress.logTail = readFileSync(paths.log, 'utf8').trimEnd().split('\n').slice(-15).join('\n');
  progress.finishedAt = new Date().toISOString();
  writeProgress(paths, progress);
  releaseLock(paths);
}
