import { isRecord, pendingPedroReleaseStep, releaseApprovalStep } from '@lar-factory/shared';
import type { WorkRecords } from '@lar-factory/work-records';

import type { BoardState } from '../board/board-state.ts';
import { readExecutionProjection } from '../t3/execution-capabilities.ts';
import { settleReleaseQuestion } from '../t3/release-question.ts';
import { sendThreadCommand } from '../t3/thread-commands.ts';
import type { Reply } from './item-commands.ts';

/** Board-only receipt: the client supplies evidence, never the recording identity. */
export function createReleaseStep({
    board,
    records,
    reread,
    send = sendThreadCommand,
    readProjection = readExecutionProjection,
}: {
    board: BoardState;
    records: WorkRecords | null;
    reread: () => void;
    send?: typeof sendThreadCommand;
    readProjection?: typeof readExecutionProjection;
}) {
    const sending = new Set<string>();
    const reconcileReleaseContinuations = async () => {
        if (!records) return;

        for (const item of board.snapshot().items) {
            if (item.recorded === false || item.parentId || !item.releasePlan || sending.has(item.id)) continue;

            sending.add(item.id);

            try {
                const { ready, run } = records.prepareReleaseContinuation(item.id);

                if (!ready || !run || run.sent || run.rejected) continue;

                const plan = records.releasePlan(item.id)!;
                const owner = records.read(run.ownerWorkId);
                const thread = records.threads(run.ownerWorkId).find((thread) => thread.threadId === run.threadId);

                if (owner.setAside || !thread || thread.deletedAt) continue;

                const observed = board.find(run.ownerWorkId);
                const request = Array.isArray(observed?.threads)
                    ? observed.threads.find((thread) => thread.id === run.threadId)?.pendingRequest
                    : undefined;

                await settleReleaseQuestion(
                    request?.threadId ?? run.threadId,
                    plan,
                    run.commandId,
                    readProjection,
                    send,
                    () => {
                        const current = records.releaseContinuation(item.id);

                        return current.ready && current.digest === run.digest;
                    },
                );

                // The request read may have yielded while a new release plan or independent hold was saved.
                const fresh = records.releaseContinuation(item.id);

                if (!fresh.ready || fresh.digest !== run.digest) continue;

                const current = records.read(item.id);

                if (
                    !current.needsYouCauses.length &&
                    (!current.needsYou || releaseApprovalStep(plan, current.needsYou))
                )
                    records.resumeFromUser(item.id, current.revision, 'In progress');

                const result = await send({
                    type: 'message.dispatch',
                    commandId: run.commandId,
                    messageId: run.messageId,
                    threadId: run.threadId,
                    createdBy: 'user',
                    creationSource: 'web',
                    attachments: [],
                    dispatchMode: { type: 'queue_after_active' },
                    text: `Continue release of group ${item.id} in this same owner. Read lar-work release-plan ${item.id}, children and completion. The board's recorded Pedro receipts are authoritative: ${JSON.stringify(plan.steps.filter((step) => step.done?.by === 'Pedro'))}. Next recorded step: ${JSON.stringify(plan.steps.find((step) => !step.done) ?? null)}. Run only unfinished Agent steps, in order, against the exact approved manifest/digests/merged SHAs; record actual evidence with complete-release-step. Re-read before each step. Never repeat a completed operation or expand the approval. When a Pedro step is next, leave it on the board and end the turn; never duplicate it with a generic Needs you notice or a T3 question. After every release receipt the board requests the final Outcome check. Merges alone prove neither activation nor Outcome.`,
                });

                records.releaseContinuationDelivered(
                    item.id,
                    run.commandId,
                    result.outcome,
                    result.outcome === 'accepted' ? undefined : result.reason,
                );
                reread();
            } catch (error) {
                const run = records.releaseContinuation(item.id).run;

                if (run)
                    records.releaseContinuationDelivered(
                        item.id,
                        run.commandId,
                        'unconfirmed',
                        (error as Error).message,
                    );
            } finally {
                sending.delete(item.id);
            }
        }
    };

    return {
        reconcileReleaseContinuations,
        async resumeRelease(id: string, input: Record<string, unknown>): Promise<Reply> {
            try {
                if (!records || !board.find(id)) throw new Error('This parent is unavailable on the board.');

                const record = records.read(id);

                if (!Number.isSafeInteger(input.revision) || input.revision !== record.revision)
                    throw new Error('The parent changed. Read its release again.');

                const continuation = records.prepareReleaseContinuation(id);

                if (!continuation.ready) {
                    const step = pendingPedroReleaseStep(records.releasePlan(id));

                    throw new Error(
                        step
                            ? `Complete release step ${step.id} with Mark release step done first.`
                            : records.read(id).needsYou
                              ? 'Resolve the Needs you notice before resuming release.'
                              : 'Complete the delivery parts and any pending board step first.',
                    );
                }

                const retryRevision = records.read(id).revision;

                if (continuation.run?.sent || continuation.run?.rejected) {
                    const projection = await readProjection(continuation.run.threadId);

                    if (!isRecord(projection) || !Array.isArray(projection.runs))
                        throw new Error('Cannot read release activity. Retry when T3 is available.');

                    if (
                        projection.runs
                            .filter(isRecord)
                            .some((run) => ['running', 'queued'].includes(String(run.status)))
                    )
                        throw new Error('The release owner is already working.');

                    records.retryReleaseContinuation(id, retryRevision);
                }

                await reconcileReleaseContinuations();
                reread();

                const result = records.releaseContinuation(id).run;

                if (!result?.sent) throw new Error(result?.error ?? 'No release owner is available.');

                return { status: 200, body: { error: null, board: board.snapshot() } };
            } catch (error) {
                return { status: 409, body: { error: (error as Error).message, board: board.snapshot() } };
            }
        },
        async completeReleaseStep(id: string, input: Record<string, unknown>): Promise<Reply> {
            try {
                if (!records || !board.find(id)) throw new Error('This parent is unavailable on the board.');

                const record = records.read(id);
                const step = pendingPedroReleaseStep(records.releasePlan(id));

                if (record.setAside || record.finishedAt || !step || step.id !== input.stepId)
                    throw new Error('This release step is no longer waiting on Pedro.');

                if (!Number.isSafeInteger(input.revision) || record.revision !== input.revision)
                    throw new Error('The parent changed. Read its release steps again.');

                if (typeof input.evidence !== 'string' || !input.evidence.trim() || input.evidence.length > 1000)
                    throw new Error('Add short release evidence (up to 1000 characters).');

                records.completeReleaseStep(id, record.revision, step.id, 'Pedro', input.evidence);
                reread();
                await reconcileReleaseContinuations();

                return { status: 200, body: { error: null, board: board.snapshot() } };
            } catch (error) {
                return { status: 409, body: { error: (error as Error).message, board: board.snapshot() } };
            }
        },
    };
}
