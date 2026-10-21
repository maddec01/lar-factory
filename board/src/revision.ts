// Process identity is captured once; only remote knowledge changes while running.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import type { CodeUpdate } from './model.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const execute = promisify(execFile);
const options = { cwd: root, timeout: 10_000, maxBuffer: 1_000_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } };
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function revisionCheck(local: Pick<CodeUpdate, 'updatable' | 'logs'>): { status: CodeUpdate; refresh: () => Promise<void> } {
  let runningRevision: string | null = null;
  try { runningRevision = execFileSync('git', ['rev-parse', 'HEAD'], { ...options, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { /* A source archive or failed Git check must not claim to be current. */ }
  const status: CodeUpdate = {
    runningRevision, remoteRevision: null, behind: null,
    error: runningRevision ? null : 'The running board revision could not be identified. Restart from a Git checkout.',
    command: `bash ${quote(root + 'board/scripts/update.sh')}`,
    ...local,
  };
  let refreshing = false;
  async function refresh(): Promise<void> {
    if (refreshing || !runningRevision) return;
    refreshing = true;
    try {
      await execute('git', ['fetch', 'origin', '+refs/heads/main:refs/remotes/origin/main'], options);
      const remote = (await execute('git', ['rev-parse', 'origin/main'], options)).stdout.trim();
      const behind = Number((await execute('git', ['rev-list', '--count', `${runningRevision}..${remote}`], options)).stdout.trim());
      status.remoteRevision = remote;
      status.behind = behind;
      status.error = null;
    } catch {
      status.error = 'Could not refresh origin/main. Check GitHub access and the checkout’s origin, then wait for the next check.';
    } finally { refreshing = false; }
  }
  return { status, refresh };
}
