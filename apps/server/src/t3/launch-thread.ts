import { isRecord, type ModelSelection, type StartResult, type ThreadLaunchRequest } from '@lar-factory/shared';
import { executionSettingsOf } from '@lar-factory/shared/execution-target';
import { randomUUID } from 'node:crypto';

import { boardSessionAuthority } from './board-session.ts';
import { verifyExecution } from './execution-report.ts';
import { subscribeProjects } from './project-subscription.ts';
import { serverRuntimeOrigin } from './t3-settings.ts';
import { rejectionReason } from './thread-commands.ts';

/** The workspace strategies of T3's `orchestration.launchThread` that the board uses. `startFromOrigin` stays unset, as the CLI leaves it. */
export type LaunchWorkspace = ThreadLaunchRequest['workspace'];
export type ExistingWorktree = Extract<LaunchWorkspace, { type: 'existing_worktree' }>;

export type LaunchThread = (
    projectId: string,
    text: string,
    selection: ModelSelection,
    workspace: LaunchWorkspace,
    runtimeMode: string,
    origin?: string,
    commandId?: string,
    remember?: (request: ThreadLaunchRequest) => void,
) => Promise<StartResult>;

export interface LaunchContext {
    commandId: string;
    remember: (request: ThreadLaunchRequest) => void;
}

/** Replaying the creation receipt also dispatches an initial message interrupted after thread creation. */
export const resumeLaunch = async (request: ThreadLaunchRequest, commandId: string): Promise<StartResult> => {
    const result = await launchThread(
        request.projectId,
        request.text,
        request.selection,
        request.workspace,
        request.runtimeMode,
        undefined,
        commandId,
    );

    // A failed authorization or connection now cannot prove the earlier request created nothing.
    return result.thread ? result : { ...result, uncertain: true };
};

/** T3 requires a concrete runtimeMode (no inherit): callers forward its project default; see docs/t3-access.md.
 * One launch under one command ID, which the server can replay if it loses its answer. A lost answer never sends a new one. */
export async function launchThread(
    projectId: string,
    text: string,
    selection: ModelSelection,
    workspace: LaunchWorkspace,
    runtimeMode: string,
    origin = serverRuntimeOrigin(process.env),
    commandId: string = randomUUID(),
    remember?: (request: ThreadLaunchRequest) => void,
): Promise<StartResult> {
    remember?.({ projectId, text, selection, workspace, runtimeMode });

    const authority = boardSessionAuthority('t3', 'orchestration:operate');
    let session;

    try {
        session = await authority.issue();
    } catch {
        return { thread: null, error: 'T3 launch authorization failed.' };
    }

    const lost: StartResult = {
        thread: null,
        uncertain: true,
        error: 'T3 has not confirmed the first turn. The board will resume the same launch.',
    };

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
                                !Array.isArray(value.projection.messages) ||
                                !value.projection.messages.some(
                                    (message) => isRecord(message) && message.role === 'user' && message.text === text,
                                ) ||
                                !Array.isArray(value.projection.runs) ||
                                !value.projection.runs.length ||
                                typeof value.resumed !== 'boolean'
                            )
                                return;

                            clearTimeout(timer);
                            stop?.();

                            if (
                                value.projection.runs.every(
                                    (run) =>
                                        isRecord(run) &&
                                        ['queued', 'preparing', 'starting'].includes(String(run.status)),
                                )
                            ) {
                                resolve({
                                    ...lost,
                                    error: 'T3 created the thread; its first turn is not running yet. The board will resume the same launch.',
                                });

                                return;
                            }

                            const thread = { threadId: value.threadId, title: text.split('\n')[0] ?? text };

                            void verifyExecution(value.projection, value.threadId, executionSettingsOf(selection)).then(
                                ({ report, failure }) =>
                                    resolve({
                                        executionReport: report,
                                        thread,
                                        error: failure,
                                        ...(failure && { hold: true as const }),
                                    }),
                                () =>
                                    resolve({
                                        thread,
                                        error: 'T3 execution verification failed. Hold this run.',
                                        hold: true,
                                    }),
                            );
                        },
                        // Only T3's own refusal says no thread started. Any other exit, such as T3 stopping, says no more than a lost answer.
                        reject(exit) {
                            clearTimeout(timer);

                            const refusal =
                                isRecord(exit) && exit._tag === 'Failure' ? rejectionReason(exit.cause) : undefined;

                            const partial =
                                isRecord(exit) &&
                                Array.isArray(exit.cause) &&
                                exit.cause.some(
                                    (part) =>
                                        isRecord(part) &&
                                        isRecord(part.error) &&
                                        typeof part.error.threadId === 'string',
                                );

                            resolve(
                                partial
                                    ? { ...lost, error: refusal ?? lost.error }
                                    : refusal
                                      ? { thread: null, error: refusal }
                                      : lost,
                            );
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
