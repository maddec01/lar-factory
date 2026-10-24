// Runs a command-line tool and resolves with how it ended; every `execFile` call in the server goes through here.

import { execFile } from 'node:child_process';

export interface RunOptions {
  env?: NodeJS.ProcessEnv;
  timeout: number;
  maxBuffer?: number;
}

export interface RunResult {
  /** 0 on success, the exit code, a spawn error code such as `ENOENT`, or null when a signal (such as the timeout) ended it. */
  code: number | string | null;
  stdout: string;
  stderr: string;
  /** Why it failed: the first four lines of its stderr, else its stdout, else the error's message. Empty on success. */
  detail: string;
}

export function runTool(file: string, args: string[], { env, timeout, maxBuffer }: RunOptions): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(file, args, { env, timeout, ...maxBuffer && { maxBuffer } }, (err, stdout, stderr) => {
      if (!err) return resolve({ code: 0, stdout, stderr, detail: '' });
      const code = ((err as NodeJS.ErrnoException).code as number | string | undefined) ?? null;
      const detail = (stderr || stdout || err.message).trim().split('\n').slice(0, 4).join('\n');
      resolve({ code, stdout, stderr, detail });
    });
  });
}
