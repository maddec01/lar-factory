// Starts T3 Code threads, and adds onboarding's new T3 projects, through the local `t3` CLI.

import { isRecord, type ModelChoice, type StartedThread, type StartResult } from '@lar-factory/shared';
import { runTool, type RunResult } from '../tools/run-tool.ts';
import { missingTool, toolCommand } from '../tools/tools.ts';

const UNCERTAIN: StartResult = { thread: null, uncertain: true,
  error: "The thread's start could not be confirmed. Check the repository's project in T3 Code before starting it again." };

/** A new git worktree for a thread: the branch it is made on, from `base`. */
export interface NewWorktree {
  base: string;
  branch: string;
}

/**
 * Runs `t3 thread start <project id> <message> --json`, with `--provider <instance id>
 * --model <slug>` for a model choice; without one T3 uses the project's default. With
 * `worktree`, `--worktree <base> --branch <branch>` runs the thread in a new worktree
 * instead of the project's folder.
 */
export async function startThread(project: string, message: string, choice?: ModelChoice, worktree?: NewWorktree, run: T3Run = runT3): Promise<StartResult> {
  const model = choice ? ['--provider', choice.instanceId, '--model', choice.model] : [];
  const where = worktree ? ['--worktree', worktree.base, '--branch', worktree.branch] : [];
  const missing = `${missingTool('t3')}. Install the T3 Code CLI or set T3_PATH.`;
  let result: RunResult;
  try {
    result = await run(['thread', 'start', project, message, ...model, ...where, '--json'], 60_000);
  } catch {
    return recoverStart(project, message, run);
  }
  const { code, stdout } = result;
  if (code === 'ENOENT') return { thread: null, error: missing };
  // A failed command can have created a thread before losing its answer.
  if (code !== 0) return recoverStart(project, message, run);
  try {
    const launched = JSON.parse(stdout) as { threadId?: unknown; title?: unknown };
    if (typeof launched.threadId !== 'string' || !launched.threadId) throw new Error('No thread id.');
    // T3 titles a thread from the first line of its first message.
    const title = typeof launched.title === 'string' ? launched.title : message.split('\n')[0] ?? message;
    return { thread: { threadId: launched.threadId, title }, error: null };
  } catch {
    return recoverStart(project, message, run);
  }
}

/** List/show can recover a late launch; absence or ambiguity never permits a retry. */
async function recoverStart(project: string, message: string, run: T3Run): Promise<StartResult> {
  const found = await findStartedThread(project, message, [], run);
  return typeof found === 'object' ? { thread: found, error: null } : UNCERTAIN;
}

/**
 * The one thread in `project` whose first user message is `message`, leaving out the `known` thread IDs a record already
 * holds: 'absent' once t3 lists none, 'unknown' when its answer can't be read or names more than one.
 */
export async function findStartedThread(project: string, message: string, known: readonly string[], run: T3Run = runT3): Promise<StartedThread | 'absent' | 'unknown'> {
  try {
    const listed = await run(['thread', 'list', '--project', project, '--json'], 10_000);
    if (listed.code !== 0) return 'unknown';
    const threads: unknown = JSON.parse(listed.stdout);
    if (!Array.isArray(threads)) return 'unknown';
    const matches: StartedThread[] = [];
    for (const thread of threads) {
      if (!isRecord(thread) || typeof thread.threadId !== 'string') return 'unknown';
      if (thread.title !== message.split('\n')[0] || known.includes(thread.threadId)) continue;
      const shown = await run(['thread', 'show', thread.threadId, '--json', '--messages', '2147483647'], 10_000);
      if (shown.code !== 0) return 'unknown';
      const answer: unknown = JSON.parse(shown.stdout);
      if (!isRecord(answer) || !isRecord(answer.thread) || answer.thread.threadId !== thread.threadId || !Array.isArray(answer.messages)) return 'unknown';
      const first = answer.messages.find(entry => isRecord(entry) && entry.role === 'user');
      if (isRecord(first) && first.text === message) matches.push({ threadId: thread.threadId, title: String(thread.title) });
    }
    return matches.length === 1 ? matches[0]! : matches.length ? 'unknown' : 'absent';
  } catch { return 'unknown'; }
}

/** Runs `t3` with these arguments and timeout; tests pass a stub. */
export type T3Run = (args: string[], timeout: number) => Promise<RunResult>;

const runT3: T3Run = (args, timeout) => {
  const command = toolCommand('t3');
  if (!command) return Promise.resolve({ code: 'ENOENT', stdout: '', stderr: '', detail: '' });
  return runTool(command.file, args, { env: command.env, timeout });
};

/** Runs `t3 project add <folder>`, returning null once T3 added it, else the problem. */
export async function addProject(folder: string): Promise<string | null> {
  const command = toolCommand('t3');
  const missing = `${missingTool('t3')}. Install the T3 Code CLI or set T3_PATH.`;
  if (!command) return missing;
  const { code, detail } = await runTool(command.file, ['project', 'add', folder], { env: command.env, timeout: 60_000 });
  if (code === 'ENOENT') return missing;
  if (code === 0) return null;
  // A signal, such as our timeout, leaves it unknown whether T3 added the folder.
  if (code === null) return "t3 didn't answer in time. Check T3 Code's projects before adding the folder again.";
  return `t3 could not add the project: ${detail}`;
}

/** Confirms deletion only from the CLI's exact unavailable response. */
export async function lookupThread(id: string, run: T3Run = runT3): Promise<'live' | 'deleted' | 'unknown'> {
  try {
    const result = await run(['thread', 'show', id, '--json', '--messages', '0'], 10_000);
    if (result.code === 1 && result.stdout === '' && result.stderr.trim() === `Thread ${id} is no longer available.`) return 'deleted';
    if (result.code === 0) {
      const answer: unknown = JSON.parse(result.stdout);
      if (isRecord(answer) && isRecord(answer.thread) && answer.thread.threadId === id) return 'live';
    }
  } catch { /* A failed lookup leaves the Start protected. */ }
  return 'unknown';
}
