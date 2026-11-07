import { isRecord } from '@lar-factory/shared';

import { readJsonRecord } from '../json-file.ts';
import { boardSessionAuthority } from './board-session.ts';
import type { BoardSession } from './project-protocol.ts';
import { subscribeProjects } from './project-subscription.ts';
import { serverRuntimePath } from './t3-settings.ts';

/** After a lost answer, retry with the same commandId, which T3 answers from its receipt. T3 answers a rejected commandId with that rejection every time, so a retry after a rejection needs a new one. */
export interface ThreadCommand {
    type: 'thread.settle' | 'thread.archive' | 'thread.delete';
    commandId: string;
    threadId: string;
}
/** Callers treat rejected and unconfirmed as failures to retry, and only unconfirmed keeps its commandId. */
export type ThreadCommandResult =
    | { outcome: 'accepted'; sequence: number }
    | { outcome: 'rejected'; reason: string }
    | { outcome: 'unconfirmed'; reason: string };

/** One connection and one request. The first answer settles the result, and nothing reconnects. */
export async function sendThreadCommand(command: ThreadCommand): Promise<ThreadCommandResult> {
    const unconfirmed = (reason: string): ThreadCommandResult => ({ outcome: 'unconfirmed', reason });
    const authority = boardSessionAuthority('t3', 'orchestration:operate');
    let session: BoardSession;
    try {
        session = await authority.issue();
    } catch {
        return unconfirmed(`T3 authorization for ${command.type} failed.`);
    }
    try {
        return await new Promise<ThreadCommandResult>((resolve) => {
            let stop: (() => void) | undefined;
            const finish = (result: ThreadCommandResult) => {
                clearTimeout(timer);
                stop?.();
                resolve(result);
            };
            const timer = setTimeout(
                () => finish(unconfirmed(`${command.type} timed out before T3 answered.`)),
                30_000,
            );
            const protocol = { subscriptionSession: async () => session, invalidateSession() {} };
            try {
                stop = subscribeProjects(
                    new URL(String(readJsonRecord(serverRuntimePath(process.env))?.origin ?? '')),
                    '',
                    protocol,
                    () => finish(unconfirmed(`The T3 connection failed before T3 answered ${command.type}.`)),
                    {
                        tag: 'orchestration.dispatchCommand',
                        payload: { type: command.type, commandId: command.commandId, threadId: command.threadId },
                        accept(value) {
                            finish(
                                isRecord(value) && Number.isInteger(value.sequence) && Number(value.sequence) >= 0
                                    ? { outcome: 'accepted', sequence: Number(value.sequence) }
                                    : unconfirmed(`T3 sent a malformed answer to ${command.type}.`),
                            );
                        },
                        reject(exit) {
                            finish(
                                isRecord(exit) && exit._tag === 'Failure'
                                    ? {
                                          outcome: 'rejected',
                                          reason: rejectionReason(exit.cause) ?? `T3 rejected ${command.type}.`,
                                      }
                                    : unconfirmed(`T3 sent a malformed answer to ${command.type}.`),
                            );
                        },
                    },
                );
            } catch {
                finish(unconfirmed(`Invalid local T3 endpoint for ${command.type}.`));
            }
        });
    } finally {
        await authority.revoke(session.sessionId).catch(() => {});
    }
}

export function rejectionReason(cause: unknown): string | undefined {
    if (!Array.isArray(cause)) return undefined;
    for (const part of cause as unknown[]) {
        if (
            isRecord(part) &&
            part._tag === 'Fail' &&
            isRecord(part.error) &&
            typeof part.error.message === 'string' &&
            part.error.message
        )
            return part.error.message;
    }
    return undefined;
}
