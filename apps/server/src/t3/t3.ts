// Starts T3 Code threads through the local `t3` CLI.

import type { ModelChoice, StartResult } from '@mux-factory/shared';
import { runTool } from '../tools/run-tool.ts';
import { missingTool, toolCommand } from '../tools/tools.ts';

const UNCERTAIN: StartResult = { thread: null, uncertain: true,
  error: "The thread's start could not be confirmed. Check the repository's project in T3 Code before starting it again." };

/**
 * Runs `t3 thread start <project id> <message> --json`, with `--provider <instance id>
 * --model <slug>` for a model choice; without one T3 uses the project's default.
 */
export async function startThread(project: string, message: string, choice?: ModelChoice): Promise<StartResult> {
  const model = choice ? ['--provider', choice.instanceId, '--model', choice.model] : [];
  const command = toolCommand('t3');
  const missing = `${missingTool('t3')}. Install the T3 Code CLI or set T3_PATH.`;
  if (!command) return { thread: null, error: missing };
  const { code, stdout, detail } = await runTool(command.file, ['thread', 'start', project, message, ...model, '--json'], { env: command.env, timeout: 60_000 });
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
