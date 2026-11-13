import {
    activityUnavailable,
    openQuestionThread,
    verificationTestSteps,
    workingAgain,
    type VerificationResult,
} from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';
import { userInfo } from 'node:os';

import type { BoardState } from '../board/board-state.ts';
import { prUrl } from '../config/pr-host.ts';
import { mergeProvider, type MergeProvider } from '../config/pr-merge.ts';
import { sendThreadCommand } from '../t3/thread-commands.ts';
import type { Reply } from './item-commands.ts';

interface Dependencies {
    board: BoardState;
    records: WorkRecords | null;
    reread: () => void;
    provider?: (repo: string) => MergeProvider;
    send?: typeof sendThreadCommand;
    identity?: () => string;
}

/** Exact PR/head submissions, and a durable retry of the same build-thread message after a lost response. */
export function createVerification({
    board,
    records,
    reread,
    provider = mergeProvider,
    send = sendThreadCommand,
    identity = () => userInfo().username,
}: Dependencies) {
    const pending = new Set<string>();
    const reply = (status: number, body: object): Reply => ({ status, body: { ...body, board: board.snapshot() } });
    const resolve = (id: string) => {
        if (!records) throw new Error('Work records are unavailable.');

        const item = board.find(id);
        const record = records.read(id);

        if (!item || item.recorded === false || record.status !== 'Verify' || record.finishedAt || record.setAside)
            throw new Error('This work is not awaiting Verify.');

        if (
            activityUnavailable(board.snapshot(), Date.now()) ||
            workingAgain(item) ||
            openQuestionThread(item) ||
            item.paused ||
            item.needsYou ||
            item.archived
        )
            throw new Error('Wait for current build activity before recording Verify.');

        if (board.snapshot().itemSourceProblems?.some((problem) => problem.repo === record.repository))
            throw new Error('The provider is disconnected. Re-read PR head.');

        const reference = record.pullRequest;

        if (!reference || !reference.startsWith(`${record.repository}#`)) throw new Error('No recorded delivery PR.');

        return { record, reference, number: Number(reference.slice(reference.lastIndexOf('#') + 1)) };
    };
    const inspect = async (id: string) => {
        const before = resolve(id);
        const evidence = await provider(before.record.repository).read(before.record.repository, before.number);
        const current = resolve(id);

        if (current.reference !== before.reference || current.record.revision !== before.record.revision)
            throw new Error('The work changed. Re-read PR head.');

        const pr = evidence.pr;

        if (
            pr.number !== before.number ||
            pr.url.toLowerCase() !== prUrl(before.record.repository, before.number).toLowerCase() ||
            pr.state !== 'open' ||
            !pr.sourceRevision
        )
            throw new Error('The delivery PR is unavailable or no longer open.');

        records!.observeVerificationHead(id, before.reference, pr.sourceRevision);
        reread();

        return {
            pr: before.reference,
            head: pr.sourceRevision,
            testSteps: verificationTestSteps(pr.body ?? ''),
            revision: records!.read(id).revision,
            by: identity(),
        };
    };
    const resume = async (id: string) => {
        if (!records) throw new Error('Work records are unavailable.');

        const state = records.verification(id);
        const delivery = state.resume;
        const result = state.latest;
        const record = records.read(id);

        if (!board.find(id)) throw new Error('This work is no longer on the board.');

        if (!delivery || delivery.sent || !result || result.result !== 'fail') return;

        if (record.finishedAt || record.setAside || record.pullRequest !== result.pr)
            throw new Error('The build changed. Its previous Verify fix request cannot be resumed.');

        const answer = await send({
            type: 'message.dispatch',
            createdBy: 'user',
            creationSource: 'web',
            commandId: delivery.commandId,
            threadId: delivery.threadId,
            messageId: delivery.messageId,
            attachments: [],
            dispatchMode: { type: 'queue_after_active' },
            text: `Verify failed for work ${id}, PR ${result.pr}, tested head ${result.head}.\n${result.by}: ${result.note}\nContinue this same build thread, branch/worktree and PR. Fix the reported failure, run checks and reassessment under the frozen build settings, and return to Verify for the new head. Do not create another item or PR; do not record a pass for Pedro.`,
        });

        records.verificationResume(
            id,
            delivery.commandId,
            answer.outcome,
            answer.outcome === 'accepted' ? undefined : answer.reason,
        );
        reread();

        if (answer.outcome !== 'accepted')
            throw new Error(`Verify failure saved. ${answer.reason} Retry sending the fix to this build.`);
    };
    const run = async (id: string, action: () => Promise<object>): Promise<Reply> => {
        if (pending.has(id)) return reply(409, { error: 'A Verify action is pending.' });

        pending.add(id);

        try {
            return reply(200, { ...(await action()), error: null });
        } catch (error) {
            return reply(409, { error: (error as Error).message });
        } finally {
            pending.delete(id);
        }
    };

    return {
        reconcileVerificationFixes: async () => {
            for (const item of board.snapshot().items) {
                if (!records || item.recorded === false || pending.has(item.id)) continue;

                const delivery = item.verification?.resume;

                if (delivery && !delivery.sent && !delivery.error)
                    await run(item.id, async () => {
                        await resume(item.id);

                        return {};
                    });
            }
        },
        inspectVerification: (id: string) => run(id, async () => ({ verification: await inspect(id) })),
        recordVerification: (id: string, input: Record<string, unknown>) =>
            run(id, async () => {
                const context = await inspect(id);

                if (input.head !== context.head || input.pr !== context.pr || input.revision !== context.revision)
                    throw new Error('The PR head or work changed. Re-read PR head and test again.');

                records!.recordVerification(id, context.revision, {
                    ...context,
                    result: input.result as VerificationResult['result'],
                    note: input.note as string | null,
                });
                reread();
                await resume(id);

                return {};
            }),
        retryVerification: (id: string) =>
            run(id, async () => {
                await resume(id);

                return {};
            }),
    };
}
