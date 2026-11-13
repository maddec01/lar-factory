import { isRecord, type ItemThread } from '@lar-factory/shared';

export type PendingRequest = NonNullable<ItemThread['pendingRequest']> & { summary?: string };

/** Only the exact pending request contributes a label; commands and tool payloads never leave the server. */
export function pendingRequest(
    shell: Record<string, unknown>,
    projection?: Record<string, unknown>,
): PendingRequest | undefined {
    const request = shell.pendingRuntimeRequest;

    if (!isRecord(request) || typeof request.id !== 'string' || typeof shell.id !== 'string') return undefined;

    const items = Array.isArray(projection?.turnItems) ? projection.turnItems : [];
    const input = items.find(
        (item) => isRecord(item) && item.requestId === request.id && item.type === 'user_input_request',
    );
    const questions = isRecord(input) && Array.isArray(input.questions) ? input.questions.filter(isRecord) : [];
    // Factory questions name the checkpoint in their title, before the colon. Do not classify from chat or a brief's contents.
    const gate = questions.some((question) => {
        const title = typeof question.question === 'string' ? question.question.split(':')[0] : '';

        return /\b(?:brief approval|approve brief|approve the brief)\b/i.test(
            `${typeof question.header === 'string' ? question.header : ''} ${title}`,
        );
    });
    const summary = questions
        .flatMap((question) => (typeof question.question === 'string' ? [question.question] : []))
        .join(' ');

    return {
        id: request.id,
        threadId: shell.id,
        kind: gate
            ? 'brief-approval'
            : ['command', 'file-read', 'file-change', 'mcp-elicitation', 'permission', 'auth_refresh'].includes(
                    String(request.kind),
                )
              ? 'tool-approval'
              : 'question',
        ...(summary ? { summary } : {}),
    };
}
