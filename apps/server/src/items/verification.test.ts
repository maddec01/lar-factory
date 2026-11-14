import type { Item, LinkedPr } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import type { sendThreadCommand } from '../t3/thread-commands.ts';
import { createPrMerge } from './pr-merge.ts';
import { createVerification } from './verification.ts';

const opened: { dir: string; records: WorkRecords }[] = [];

afterEach(() => {
    for (const { dir, records } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'verify-api-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    opened.push({ dir, records });

    let record = records.create({ title: 'Build', repository: 'owner/repo', kind: 'bug', status: 'Verify' });

    record = records.setPullRequest(record.workId, record.revision, 'owner/repo#8');
    record = records.addThread(record.workId, record.revision, 'same-build', 'build');

    const pr: LinkedPr = {
        number: 8,
        url: 'https://github.com/owner/repo/pull/8',
        state: 'open',
        isDraft: false,
        sourceRevision: 'a'.repeat(40),
        body: '## Test steps\n1. Press the button.\n## Checks\nPassed.',
        checks: null,
        mergeState: 'can merge',
    };
    const item = {
        id: record.workId,
        recorded: true,
        repo: record.repository,
        status: 'Verify',
        linkedPrs: [pr],
        threads: [],
        slices: [],
    } as unknown as Item;
    const board = createBoardState({
        items: [item],
        repos: [],
        firstRead: { settled: true },
        fetchedAt: new Date().toISOString(),
        refreshSeconds: 300,
    } as never);
    const reread = () => {
        const current = records.read(item.id);

        board.update({
            items: [
                {
                    ...item,
                    status: current.status,
                    revision: current.revision,
                    verification: records.verification(item.id),
                    linkedPrs: [{ ...pr }],
                },
            ],
        });
    };
    const read = vi.fn(async () => ({ pr: { ...pr }, methods: ['squash'] as const, blockers: [] }));
    const merge = vi.fn(async () => {});
    const send = vi.fn<typeof sendThreadCommand>(async () => ({ outcome: 'accepted' as const, sequence: 1 }));
    const provider = () => ({ read, merge });
    const commands = createVerification({ board, records, reread, provider, send, identity: () => 'Pedro' });
    const context = async () =>
        ((await commands.inspectVerification(item.id)).body as { verification: Record<string, unknown> }).verification;

    return {
        records,
        item,
        pr,
        board,
        reread,
        read,
        send,
        commands,
        context,
        merging: createPrMerge({ board, records, reread, provider }),
        merge,
    };
}

test('desk pass binds the freshly read PR head and server operator, then allows merge inspection', async () => {
    const s = await setup();
    const context = await s.context();

    expect(context).toMatchObject({ head: s.pr.sourceRevision, testSteps: '1. Press the button.' });

    const result = await s.commands.recordVerification(s.item.id, { ...context, result: 'pass', by: 'forged' });

    expect(result.status).toBe(200);
    expect(s.records.verification(s.item.id).latest).toMatchObject({ by: 'Pedro', head: s.pr.sourceRevision });
    expect((await s.merging.inspectMerge(s.item.id)).status).toBe(200);
    s.pr.sourceRevision = 'b'.repeat(40);
    expect((await s.merging.inspectMerge(s.item.id)).status).toBe(409);
    expect(s.records.read(s.item.id).status).toBe('Verify');
    expect(s.merge).not.toHaveBeenCalled();
});
test('new head between inspection and pass refuses stale evidence without a result', async () => {
    const s = await setup();
    const context = await s.context();

    s.pr.sourceRevision = 'b'.repeat(40);
    expect((await s.commands.recordVerification(s.item.id, { ...context, result: 'pass' })).status).toBe(409);
    expect(s.records.verification(s.item.id).latest).toBeNull();
});
test('a failure persists its note and retries the same thread/message after an uncertain delivery', async () => {
    const s = await setup();
    const context = await s.context();

    s.send.mockResolvedValueOnce({ outcome: 'unconfirmed', reason: 'Offline' } as never);

    const answer = await s.commands.recordVerification(s.item.id, {
        ...context,
        result: 'fail',
        note: 'Clipped at 390px.',
    });

    expect(answer.status).toBe(409);
    expect(s.records.read(s.item.id)).toMatchObject({ status: 'In progress', pullRequest: 'owner/repo#8' });
    expect(s.records.verification(s.item.id).latest?.note).toBe('Clipped at 390px.');
    expect((await s.commands.retryVerification(s.item.id)).status).toBe(200);
    expect(s.send.mock.calls[1]).toEqual(s.send.mock.calls[0]);
    expect(s.send.mock.calls[0]![0]).toMatchObject({
        threadId: 'same-build',
        type: 'message.dispatch',
        createdBy: 'user',
        creationSource: 'web',
        text: expect.stringContaining('Clipped at 390px.'),
    });
    expect(s.records.list({})).toHaveLength(1);
});
test('merge rechecks Verify after confirmation and refuses a newly pushed head', async () => {
    const s = await setup();
    const context = await s.context();

    await s.commands.recordVerification(s.item.id, { ...context, result: 'pass' });

    const confirmation = ((await s.merging.inspectMerge(s.item.id)).body as { confirmation: { token: string } })
        .confirmation;

    s.pr.sourceRevision = 'b'.repeat(40);
    expect((await s.merging.mergePr(s.item.id, { token: confirmation.token, method: 'squash' })).status).toBe(409);
    expect(s.merge).not.toHaveBeenCalled();
});

test('a CLI-recorded failure is delivered by the board reconciliation after restart', async () => {
    const s = await setup();
    const context = await s.context();

    s.records.recordVerification(s.item.id, Number(context.revision), {
        pr: String(context.pr),
        head: String(context.head),
        result: 'fail',
        by: 'Pedro',
        note: 'CLI failure.',
        testSteps: String(context.testSteps),
    });
    s.reread();
    await s.commands.reconcileVerificationFixes();
    expect(s.send).toHaveBeenCalledOnce();
    expect(s.records.verification(s.item.id).resume?.sent).toBe(true);
    await s.commands.reconcileVerificationFixes();
    expect(s.send).toHaveBeenCalledOnce();
});

test('concurrent head inspection identifies a pending read for automatic UI retry', async () => {
    const s = await setup();
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
        finish = resolve;
    });

    s.read.mockImplementationOnce(async () => {
        await waiting;

        return { pr: { ...s.pr }, methods: ['squash'] as const, blockers: [] };
    });

    const first = s.commands.inspectVerification(s.item.id);

    expect((await s.commands.inspectVerification(s.item.id)).body).toMatchObject({ verificationPending: true });
    finish();
    expect((await first).status).toBe(200);
    expect((await s.commands.inspectVerification(s.item.id)).status).toBe(200);
});
