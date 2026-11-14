import type { ReleasePlan } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { settleReleaseQuestion } from './release-question.ts';

const plan: ReleasePlan = {
    steps: [
        {
            id: 'approve',
            who: 'Pedro',
            what: 'Approve activation of manifest',
            done: { by: 'Pedro', at: '2026-11-14T12:00:00Z', evidence: `Approved manifest ${'a'.repeat(64)}.` },
        },
    ],
    outcomeCheck: { what: 'Check composition', result: 'pending', evidence: null },
};
const projection = (kind: string, questions: unknown[]) => ({
    thread: { id: 'owner' },
    runtimeRequests: [{ id: 'q', status: 'pending', kind }],
    turnItems: [{ type: 'user_input_request', requestId: 'q', questions }],
});

test.each([
    ['user_input', [{ id: '0', question: 'Which manifest should I approve?' }]],
    ['permission', [{ id: '0', question: 'Approve activation of manifest?' }]],
    [
        'user_input',
        [
            { id: '0', question: 'Approve activation of manifest?' },
            { id: '1', question: 'Which region?' },
        ],
    ],
    ['user_input', [{ id: '0', question: `Approve activation of manifest ${'b'.repeat(64)}?` }]],
] as const)('never settles an independent/mixed or tool request (%s)', async (kind, questions) => {
    const send = vi.fn();

    await expect(
        settleReleaseQuestion(
            'owner',
            plan,
            'stable',
            vi.fn().mockResolvedValue(projection(kind, [...questions])),
            send,
        ),
    ).rejects.toThrow(/independent/);
    expect(send).not.toHaveBeenCalled();
});

test('forwards the exact saved receipt with stable request IDs, never an approval decision', async () => {
    const read = vi
        .fn()
        .mockResolvedValue(
            projection('user_input', [{ id: '0', question: `Approve activation of manifest ${'a'.repeat(64)}?` }]),
        );
    const send = vi.fn().mockResolvedValue({ outcome: 'accepted', sequence: 1 });

    await settleReleaseQuestion('owner', plan, 'stable', read, send);
    await settleReleaseQuestion('owner', plan, 'stable', read, send);
    expect(send.mock.calls[0]![0]).toEqual(send.mock.calls[1]![0]);
    expect(send.mock.calls[0]![0]).toMatchObject({
        type: 'runtime-request.respond',
        answers: { '0': expect.stringContaining(plan.steps[0]!.done!.evidence) },
    });
    expect(send.mock.calls[0]![0]).not.toHaveProperty('decision');
});

test('a changed plan while the request read is in flight cannot forward the old board decision', async () => {
    const send = vi.fn();

    await expect(
        settleReleaseQuestion(
            'owner',
            plan,
            'stable',
            vi
                .fn()
                .mockResolvedValue(
                    projection('user_input', [{ id: '0', question: 'Approve activation of manifest?' }]),
                ),
            send,
            () => false,
        ),
    ).rejects.toThrow(/release changed/);
    expect(send).not.toHaveBeenCalled();
});
