import { expect, test } from 'vite-plus/test';

import { executionItemThreads } from './item-execution.ts';
import { pendingRequest } from './pending-request.ts';

const shell = {
    id: 'owner',
    updatedAt: '2026-11-13T12:00:00Z',
    pendingRuntimeRequest: { id: 'pending', kind: 'user_input' },
};
const input = {
    type: 'user_input_request',
    requestId: 'pending',
    questions: [
        {
            header: 'Question',
            question:
                'Q3 - Revised brief approval: Does this exact version meet your expectations and may it be marked Ready?',
        },
    ],
};

test('only the exact pending question names its brief gate', () => {
    expect(pendingRequest(shell, { turnItems: [input] })).toMatchObject({
        kind: 'brief-approval',
        summary: input.questions[0]!.question,
    });
    expect(pendingRequest(shell, { turnItems: [{ ...input, requestId: 'answered' }] })?.kind).toBe('question');
    expect(pendingRequest({ ...shell, pendingRuntimeRequest: null }, { turnItems: [input] })).toBeUndefined();
});

test('a changed shell request cannot reuse an old gate title', () => {
    const request = pendingRequest(shell, { turnItems: [input] })!;
    const lookup = executionItemThreads(
        [{ ...shell, pendingRuntimeRequest: { id: 'new', kind: 'user_input' } }],
        new Map([['owner', request]]),
    );

    expect(lookup(['owner'])?.[0]?.pendingRequest).toEqual({ id: 'new', threadId: 'owner', kind: 'question' });
});

test('the exact pending approval exposes only its display prompt and reason and names its child owner', () => {
    const approval = { ...shell, title: 'Explore sandbox', pendingRuntimeRequest: { id: 'approval', kind: 'command' } };
    const projection = {
        turnItems: [
            { type: 'approval_request', requestId: 'old', prompt: 'Stale request' },
            {
                type: 'approval_request',
                requestId: 'approval',
                prompt: 'Read sandbox folder?',
                reason: 'Inspect its fixture.',
                command: 'private command',
                arguments: { token: 'private' },
            },
        ],
    };
    const request = pendingRequest(approval, projection)!;

    expect(request).toEqual({
        id: 'approval',
        threadId: 'owner',
        kind: 'tool-approval',
        ownerTitle: 'Explore sandbox',
        summary: 'Read sandbox folder? Inspect its fixture.',
    });

    const roots = [{ id: 'root', title: 'Shape sandbox', status: 'running', updatedAt: shell.updatedAt }];
    const waiting = executionItemThreads(
        [...roots, { ...approval, lineage: { parentThreadId: 'root' } }],
        new Map([['owner', request]]),
    )(['root'])![0]!;

    expect(waiting).toMatchObject({
        childNeedsYou: true,
        pendingRequest: { ownerTitle: 'Explore sandbox', threadId: 'owner', kind: 'tool-approval' },
        questionSummary: request.summary,
    });
    expect(JSON.stringify(waiting)).not.toContain('private');
    expect(pendingRequest({ ...approval, pendingRuntimeRequest: null }, projection)).toBeUndefined();

    const resolved = executionItemThreads(roots, new Map([['owner', request]]))(['root'])![0]!;

    expect(resolved.pendingRequest).toBeUndefined();
    expect(resolved.childNeedsYou).toBeUndefined();
});
