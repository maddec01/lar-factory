import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';

const root = fileURLToPath(new URL('../../', import.meta.url));
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 30_000 }).trim();
const board = fileURLToPath(new URL('../', import.meta.url));

async function waitForBoard(port: number, revision: string, launchToken: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(750), redirect: 'error' });
      const health = await response.json() as { runningRevision?: string; launchToken?: string };
      if (response.ok && health.runningRevision === revision && health.launchToken === launchToken) return;
    } catch { /* A successful launchctl call may still be followed by a crash or bind failure. */ }
    await setTimeout(250);
  }
  throw new Error(`The expected board revision ${revision} did not become ready on port ${port}. Check ~/Library/Logs/mux-board.log and the port, then rerun.`);
}

let step = 'check checkout';
try {
  if (git('branch', '--show-current') !== 'main') throw new Error('Switch this checkout to main before updating.');
  if (git('status', '--porcelain')) throw new Error('Commit or stash local changes (including untracked files), then rerun.');
  step = 'fetch origin/main';
  git('fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main');
  const local = git('rev-parse', 'HEAD');
  const remote = git('rev-parse', 'origin/main');
  step = 'check fast-forward';
  if (git('rev-list', '--count', `${remote}..${local}`) !== '0') {
    throw new Error('Local main is ahead of or diverged from origin/main. Preserve and reconcile your commits manually, then rerun; only equal or fast-forward updates are allowed.');
  }
  step = 'fast-forward main';
  git('merge', '--ff-only', remote);
  step = 'install board dependencies (npm ci)';
  console.log(step);
  execFileSync('npm', ['ci'], { cwd: board, stdio: 'inherit' });
  step = 'refresh and restart launch agent';
  console.log(step);
  const launchToken = randomUUID();
  execFileSync('bash', [fileURLToPath(new URL('./install-launch-agent.sh', import.meta.url))], {
    cwd: board, stdio: 'inherit', env: { ...process.env, BOARD_LAUNCH_TOKEN: launchToken },
  });
  step = 'confirm board readiness';
  console.log(step);
  const config = JSON.parse(readFileSync(new URL('../../config.json', import.meta.url), 'utf8')) as { board?: { port?: number } };
  await waitForBoard(config.board?.port ?? 4317, remote, launchToken);
  step = 'update global skills';
  console.log(step);
  execFileSync('npx', ['skills', 'update', '-g'], { cwd: root, stdio: 'inherit' });
  step = 'synchronize extra Claude profiles (partial update if conflicts remain)';
  console.log(step);
  execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('./sync-claude-skills.ts', import.meta.url))], { stdio: 'inherit' });
  console.log(`Update complete: board ${remote} is running, global skills are updated and extra Claude profiles are synchronized.`);
} catch (error) {
  console.error(`Update failed at ${step}: ${(error as Error).message}`);
  process.exitCode = 1;
}
