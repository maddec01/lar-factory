// Starts T3 Code threads, and adds onboarding's new T3 projects, through the local `t3` CLI.

import { isRecord, type ModelChoice, type StartResult } from '@lar-factory/shared';
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
export async function startThread(project: string, message: string, choice?: ModelChoice, worktree?: NewWorktree): Promise<StartResult> {
  const model = choice ? ['--provider', choice.instanceId, '--model', choice.model] : [];
  const where = worktree ? ['--worktree', worktree.base, '--branch', worktree.branch] : [];
  const command = toolCommand('t3');
  const missing = `${missingTool('t3')}. Install the T3 Code CLI or set T3_PATH.`;
  if (!command) return { thread: null, error: missing };
  const { code, stdout, detail } = await runTool(command.file, ['thread', 'start', project, message, ...model, ...where, '--json'], { env: command.env, timeout: 60_000 });
  if (code === 'ENOENT') return { thread: null, error: missing };
  // An exit code means t3 itself reported the failure; a signal (such as our timeout) leaves it unknown.
  if (typeof code !== 'number') return UNCERTAIN;
  if (code !== 0) return { thread: null, error: `t3 could not start the thread: ${detail}` };
  try {
    const launched = JSON.parse(stdout) as { threadId?: unknown; title?: unknown };
    if (typeof launched.threadId !== 'string' || !launched.threadId) throw new Error('No thread id.');
    // T3 titles a thread from the first line of its first message.
    const title = typeof launched.title === 'string' ? launched.title : message.split('\n')[0] ?? message;
    return { thread: { threadId: launched.threadId, title }, error: null };
  } catch {
    return UNCERTAIN;
  }
}

/** Runs `t3` with these arguments and timeout; tests pass a stub. */
export type T3Run = (args: string[], timeout: number) => Promise<RunResult>;

const runT3: T3Run = (args, timeout) => {
  const command = toolCommand('t3');
  if (!command) return Promise.resolve({ code: 'ENOENT', stdout: '', stderr: '', detail: '' });
  return runTool(command.file, args, { env: command.env, timeout });
};

/** How long a waiting start waits for its run. */
const WAIT_TIMEOUT = 15 * 60_000;

/**
 * How a waited run ended: completed with its reply, failed or stopped with why, waiting on the user, or past the
 * timeout. The thread id comes from t3's answer at the end, so a timeout or a start that failed has none.
 */
export type WaitedRun =
  | { ended: 'completed'; threadId: string; reply: string }
  | { ended: 'failed'; threadId: string | null; why: string }
  | { ended: 'waiting'; threadId: string }
  | { ended: 'timed-out'; threadId: null };

/**
 * Runs `t3 thread start <project id> <message> --title <title> --provider <instance id> --model <slug> --wait --json`
 * and waits up to 15 minutes for the run. t3 exits 0 for a completed run, 1 for a failed or stopped one and 2 for an
 * agent waiting on the user. T3 starts the thread in the project's default runtime mode, which t3 has no flag for.
 */
export async function startThreadAndWait(project: string, message: string, choice: ModelChoice, title: string,
  run: T3Run = runT3): Promise<WaitedRun> {
  const { code, stdout, detail } = await run(['thread', 'start', project, message, '--title', title,
    '--provider', choice.instanceId, '--model', choice.model, '--wait', '--json'], WAIT_TIMEOUT);
  if (code === 'ENOENT') return { ended: 'failed', threadId: null, why: `${missingTool('t3')}. Install the T3 Code CLI or set T3_PATH.` };
  // A signal is our timeout; the thread may still be running in T3.
  if (code === null) return { ended: 'timed-out', threadId: null };
  const answer = waitAnswer(stdout);
  if (!answer) return { ended: 'failed', threadId: null, why: `t3 could not start the thread: ${detail || 'its answer was not JSON.'}` };
  if (code === 0 && typeof answer.reply === 'string') return { ended: 'completed', threadId: answer.threadId, reply: answer.reply };
  if (code === 2) return { ended: 'waiting', threadId: answer.threadId };
  const error = typeof answer.error === 'string' && answer.error.trim() ? answer.error.trim() : detail;
  return { ended: 'failed', threadId: answer.threadId, why: `The run ended ${String(answer.status ?? 'without a reply')}${error ? `: ${error}` : '.'}` };
}

/** t3's `--wait --json` answer, or null when it printed none. */
function waitAnswer(stdout: string): { threadId: string; status?: unknown; reply?: unknown; error?: unknown } | null {
  try {
    const answer = JSON.parse(stdout) as unknown;
    return isRecord(answer) && typeof answer.threadId === 'string' && answer.threadId ? { ...answer, threadId: answer.threadId } : null;
  } catch {
    return null;
  }
}

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
