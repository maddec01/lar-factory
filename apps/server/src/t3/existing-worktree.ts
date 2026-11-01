import { isRecord, type ModelChoice, type StartResult } from '@lar-factory/shared';
import { boardSessionAuthority } from './board-session.ts';
import { subscribeProjects } from './project-subscription.ts';
import type { ProjectProtocol } from './project-protocol.ts';

/** Keep commandId stable across retries, including when the server loses its answer. */
export interface ExistingWorktree {
  type: 'existing_worktree';
  worktreePath: string;
  branch: string;
  origin: string;
  commandId: string;
}

export async function launchExistingWorktree(projectId: string, text: string, choice: ModelChoice | undefined, workspace: ExistingWorktree): Promise<StartResult> {
  if (!choice) return { thread: null, error: 'Choose a model before continuing in an existing worktree.' };
  const authority = boardSessionAuthority('t3', 'orchestration:operate');
  let session;
  try { session = await authority.issue(); }
  catch { return { thread: null, error: 'T3 launch authorization failed.' }; }
  try {
    return await new Promise<StartResult>(resolve => {
      let stop: (() => void) | undefined;
      const timer = setTimeout(() => {
        stop?.();
        resolve({ thread: null, uncertain: true, error: 'T3 launch could not be confirmed. Retry with the same command identity.' });
      }, 30_000);
      try {
        stop = subscribeProjects(new URL(workspace.origin), '', { subscriptionSession: async () => session } as ProjectProtocol, () => {}, {
          tag: 'orchestration.launchThread',
          payload: { commandId: workspace.commandId, projectId, title: text.split('\n')[0], modelSelection: choice,
            runtimeMode: 'approval-required', interactionMode: 'default',
            workspaceStrategy: { type: workspace.type, worktreePath: workspace.worktreePath, branch: workspace.branch },
            initialMessage: { text, attachments: [] } },
          accept(value) {
            if (!isRecord(value) || typeof value.threadId !== 'string' || !value.threadId || !isRecord(value.projection) || typeof value.resumed !== 'boolean') return;
            clearTimeout(timer);
            stop?.();
            resolve({ thread: { threadId: value.threadId, title: text.split('\n')[0] ?? text }, error: null });
          },
        });
      } catch {
        clearTimeout(timer);
        resolve({ thread: null, error: 'Invalid local T3 launch endpoint.' });
      }
    });
  } finally { await authority.revoke(session.sessionId).catch(() => {}); }
}
