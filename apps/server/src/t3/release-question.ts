import { isRecord, releaseApprovalStep, type ReleasePlan } from '@lar-factory/shared';
import { createHash } from 'node:crypto';

import { readExecutionProjection } from './execution-capabilities.ts';
import { sendThreadCommand } from './thread-commands.ts';

/** Forward the existing board decision, never invent an answer or respond to a tool approval. */
export async function settleReleaseQuestion(
    threadId: string,
    plan: ReleasePlan,
    commandId: string,
    read = readExecutionProjection,
    send = sendThreadCommand,
    stillCurrent: () => boolean = () => true,
) {
    const value = await read(threadId);

    if (
        !isRecord(value) ||
        !isRecord(value.thread) ||
        value.thread.id !== threadId ||
        !Array.isArray(value.runtimeRequests)
    )
        throw new Error('Cannot read current release-owner requests. Retry when T3 is available.');

    for (const request of value.runtimeRequests.filter(isRecord).filter((request) => request.status === 'pending')) {
        const input =
            Array.isArray(value.turnItems) &&
            value.turnItems
                .filter(isRecord)
                .find((item) => item.type === 'user_input_request' && item.requestId === request.id);
        const questions = input && Array.isArray(input.questions) ? input.questions.filter(isRecord) : [];
        const answers: Record<string, string> = {};

        if (request.kind !== 'user_input' || typeof request.id !== 'string' || !questions.length)
            throw new Error('The release owner has an independent request. Answer it in T3.');

        for (const question of questions) {
            const step = releaseApprovalStep(
                plan,
                typeof question.question === 'string' ? question.question : undefined,
            );

            if (typeof question.id !== 'string' || !step?.done || step.done.by !== 'Pedro')
                throw new Error('The release owner has an independent question. Answer it in T3.');

            answers[question.id] =
                `Superseded by board release step ${step.id}, recorded by ${step.done.by} at ${step.done.at}: ${step.done.evidence}. This forwards the recorded board decision; it grants no additional approval.`;
        }

        if (!stillCurrent()) throw new Error('The release changed while reading the question. Read it again.');

        const result = await send({
            type: 'runtime-request.respond',
            commandId: createHash('sha256').update(`${commandId}:${request.id}`).digest('hex'),
            threadId,
            requestId: request.id,
            answers,
        });

        if (result.outcome !== 'accepted') throw new Error(result.reason);
    }
}
