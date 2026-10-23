// Starts T3 Code threads through the local `t3` CLI.

import { execFile } from 'node:child_process';
import type { ModelChoice, StartedThread } from './model.ts';
import { missingTool, toolCommand } from './tools.ts';

export interface StartResult {
  thread: StartedThread | null;
  error: string | null;
  /** The thread may have started; starting again could make a second one. */
  uncertain?: boolean;
}

const UNCERTAIN: StartResult = { thread: null, uncertain: true,
  error: "The thread's start could not be confirmed. Check the repository's project in T3 Code before starting it again." };

/**
 * Runs `t3 thread start <project id> <message> --json`, with `--provider <instance id>
 * --model <slug>` for a model choice; without one T3 uses the project's default.
 */
export function startThread(project: string, message: string, choice?: ModelChoice): Promise<StartResult> {
  const model = choice ? ['--provider', choice.instanceId, '--model', choice.model] : [];
  const command = toolCommand('t3');
  const missing = `${missingTool('t3')} Install the T3 Code CLI or set T3_PATH.`;
  if (!command) return Promise.resolve({ thread: null, error: missing });
  return new Promise((resolve) => {
    execFile(command.file, ['thread', 'start', project, message, ...model, '--json'], { env: command.env, timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code as unknown;
        if (code === 'ENOENT') return resolve({ thread: null, error: missing });
        // An exit code means t3 itself reported the failure; a signal (such as our timeout) leaves it unknown.
        if (typeof code !== 'number') return resolve(UNCERTAIN);
        const detail = (stderr || stdout || err.message).trim().split('\n').slice(0, 4).join('\n');
        return resolve({ thread: null, error: `t3 could not start the thread: ${detail}` });
      }
      try {
        const launched = JSON.parse(stdout) as { threadId?: unknown; title?: unknown };
        if (typeof launched.threadId !== 'string' || !launched.threadId) throw new Error('No thread id.');
        // T3 titles a thread from the first line of its first message.
        const title = typeof launched.title === 'string' ? launched.title : message.split('\n')[0] ?? message;
        resolve({ thread: { threadId: launched.threadId, title }, error: null });
      } catch {
        resolve(UNCERTAIN);
      }
    });
  });
}
