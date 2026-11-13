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

test.each(['command', 'file-read', 'file-change', 'permission', 'mcp-elicitation', 'auth_refresh'])(
    '%s is a tool approval with no command exposure',
    (kind) => {
        expect(
            pendingRequest({ ...shell, pendingRuntimeRequest: { id: 'pending', kind, command: 'private' } }),
        ).toEqual({ id: 'pending', threadId: 'owner', kind: 'tool-approval' });
    },
);

test('only the exact pending question names its brief gate', () => {
    expect(pendingRequest(shell, { turnItems: [input] })).toMatchObject({
        kind: 'brief-approval',
        summary: input.questions[0]!.question,
    });
    expect(pendingRequest(shell, { turnItems: [{ ...input, requestId: 'answered' }] })?.kind).toBe('question');
    expect(pendingRequest({ ...shell, pendingRuntimeRequest: null }, { turnItems: [input] })).toBeUndefined();
});

test('ordinary brief questions and chat do not become gate approvals', () => {
    expect(
        pendingRequest(shell, {
            turnItems: [{ ...input, questions: [{ header: 'Scope', question: 'Which files belong in the brief?' }] }],
            messages: [{ text: 'Approve brief' }],
        })?.kind,
    ).toBe('question');
});

test('a descendant request retains its kind and exact owner on its parent', () => {
    const request = pendingRequest(shell, { turnItems: [input] })!;
    const lookup = executionItemThreads(
        [
            { id: 'root', updatedAt: shell.updatedAt, status: 'completed' },
            { ...shell, lineage: { parentThreadId: 'root' } },
        ],
        new Map([['owner', request]]),
    );

    expect(lookup(['root'])?.[0]).toMatchObject({
        childNeedsYou: true,
        pendingRequest: { id: 'pending', threadId: 'owner', kind: 'brief-approval' },
    });
});

test('a changed shell request cannot reuse an old gate title', () => {
    const request = pendingRequest(shell, { turnItems: [input] })!;
    const lookup = executionItemThreads(
        [{ ...shell, pendingRuntimeRequest: { id: 'new', kind: 'user_input' } }],
        new Map([['owner', request]]),
    );

    expect(lookup(['owner'])?.[0]?.pendingRequest).toEqual({ id: 'new', threadId: 'owner', kind: 'question' });
});
