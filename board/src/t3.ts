// Starts T3 Code threads through the local `t3` CLI.

import { execFile } from 'node:child_process';
import type { StartedThread } from './model.ts';

const T3 = process.env.T3_PATH || 't3';

export interface StartResult {
  thread: StartedThread | null;
  error: string | null;
  /** The thread may have started; starting again could make a second one. */
  uncertain?: boolean;
}

const UNCERTAIN: StartResult = { thread: null, uncertain: true,
  error: "The thread's start could not be confirmed. Check the repository's project in T3 Code before starting it again." };

/** Runs `t3 thread start <project id> <message> --json`. */
export function startThread(project: string, message: string): Promise<StartResult> {
  return new Promise((resolve) => {
    execFile(T3, ['thread', 'start', project, message, '--json'], { timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) {
        const code = (err as NodeJS.ErrnoException).code as unknown;
        if (code === 'ENOENT') return resolve({ thread: null, error: `${T3} was not found. Install the T3 Code CLI or set T3_PATH.` });
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
