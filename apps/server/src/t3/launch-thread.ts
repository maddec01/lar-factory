import { isRecord, type ModelSelection, type StartResult } from '@lar-factory/shared';
import { randomUUID } from 'node:crypto';

import { readJsonRecord } from '../json-file.ts';
import { boardSessionAuthority } from './board-session.ts';
import { subscribeProjects } from './project-subscription.ts';
import { serverRuntimePath } from './t3-settings.ts';
import { rejectionReason } from './thread-commands.ts';

/** The workspace strategies of T3's `orchestration.launchThread` that the board uses. `startFromOrigin` stays unset, as the CLI leaves it. */
export type LaunchWorkspace =
    | { type: 'root' }
    | { type: 'worktree'; baseRef: string; branch: string }
    | ExistingWorktree;

export interface ExistingWorktree {
    type: 'existing_worktree';
    worktreePath: string;
    branch: string;
}

export type LaunchThread = (
    projectId: string,
    text: string,
    selection: ModelSelection,
    workspace: LaunchWorkspace,
    runtimeMode: string,
) => Promise<StartResult>;

/** One launch under one command ID, which the server can replay if it loses its answer. A lost answer never sends a new one. */
export async function launchThread(
    projectId: string,
    text: string,
    selection: ModelSelection,
    workspace: LaunchWorkspace,
    runtimeMode: string,
    origin = String(readJsonRecord(serverRuntimePath(process.env))?.origin ?? ''),
    commandId: string = randomUUID(),
): Promise<StartResult> {
    const authority = boardSessionAuthority('t3', 'orchestration:operate');
    let session;

    try {
        session = await authority.issue();
    } catch {
        return { thread: null, error: 'T3 launch authorization failed.' };
    }

    const lost: StartResult = { thread: null, uncertain: true, error: 'T3 launch could not be confirmed.' };

    try {
        return await new Promise<StartResult>((resolve) => {
            let stop: (() => void) | undefined;
            const timer = setTimeout(() => {
                stop?.();
                resolve(lost);
            }, 30_000);

            try {
                stop = subscribeProjects(
                    new URL(origin),
                    '',
                    { subscriptionSession: async () => session, invalidateSession() {} },
                    () => {},
                    {
                        tag: 'orchestration.launchThread',
                        payload: {
                            commandId,
                            projectId,
                            title: text.split('\n')[0],
                            modelSelection: selection,
                            runtimeMode,
                            interactionMode: 'default',
                            workspaceStrategy: workspace,
                            initialMessage: { text, attachments: [] },
                        },
                        accept(value) {
                            if (
                                !isRecord(value) ||
                                typeof value.threadId !== 'string' ||
                                !value.threadId ||
                                !isRecord(value.projection) ||
                                typeof value.resumed !== 'boolean'
                            )
                                return;

                            clearTimeout(timer);
                            stop?.();
                            resolve({
                                thread: { threadId: value.threadId, title: text.split('\n')[0] ?? text },
                                error: null,
                            });
                        },
                        // Only T3's own refusal says no thread started. Any other exit, such as T3 stopping, says no more than a lost answer.
                        reject(exit) {
                            clearTimeout(timer);

                            const refusal =
                                isRecord(exit) && exit._tag === 'Failure' ? rejectionReason(exit.cause) : undefined;

                            resolve(refusal ? { thread: null, error: refusal } : lost);
                        },
                    },
                );
            } catch {
                clearTimeout(timer);
                resolve({ thread: null, error: 'Invalid local T3 launch endpoint.' });
            }
        });
    } finally {
        await authority.revoke(session.sessionId).catch(() => {});
    }
}
