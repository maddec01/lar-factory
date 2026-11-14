import type { Item } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { completeBrief } from '../../test/complete-brief.ts';
import { createBoardState } from '../board/board-state.ts';
import type { sendThreadCommand } from '../t3/thread-commands.ts';
import { createBriefApproval } from './brief-approval.ts';
import { recordItems } from './record-items.ts';

const opened: { dir: string; records: WorkRecords }[] = [];

afterEach(() => {
    for (const { dir, records } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'human-gate-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    opened.push({ dir, records });

    const ids = [0, 1].map((index) => {
        let work = records.create({
            title: `Build ${index}`,
            repository: 'fake/app',
            kind: 'build',
            status: 'Shaping',
        });

        work = records.setBody(work.workId, work.revision, 'brief', completeBrief(`Complete brief ${index}.`));

        const input = records.doubtPackage(work.workId);

        records.recordDoubt(work.workId, input.packageDigest, 'Doubt', 'Clean.', []);

        return work.workId;
    });
    const board = createBoardState({
        items: ids.map((id) => ({ id }) as Item),
        repos: [],
        firstRead: { settled: true },
    } as never);
    const refresh = vi.fn(async () => {});
    const sync = vi.fn(async () => {});
    const commands = createBriefApproval({ board, records, reread: vi.fn(), refresh, sync, identity: () => 'Pedro' });
    const inspect = async (workIds = [ids[0]!]) => {
        const result = await commands.inspectBrief(ids[0]!, { workIds });

        expect(result.status).toBe(200);

        return (result.body as { approval: { requestId: string; digest: string; briefs: { brief: string }[] } })
            .approval;
    };

    return { records, ids, commands, inspect, refresh, sync };
}

test('board approval requires a displayed one-use request and supplies its own operator identity', async () => {
    const s = await setup();
    const id = s.ids[0]!;

    expect(
        (
            await s.commands.approveBrief(id, {
                digest: s.records.displayGate(id).approvalDigest,
                by: 'Pedro',
                evidence: 'Yes',
            })
        ).status,
    ).toBe(409);
    expect(s.records.gate(id).evidence).toEqual([]);

    const preview = await s.inspect();

    expect(preview.briefs[0]?.brief).toBe(completeBrief('Complete brief 0.'));

    const waiting = s.records.read(id);

    s.records.waitForUser(id, waiting.revision, 'Approve this brief');
    expect((await s.commands.approveBrief(id, { ...preview, by: 'Agent', evidence: 'Verify failed' })).status).toBe(
        200,
    );
    expect(s.records.gate(id).passing).toMatchObject({
        approvedBy: 'Pedro',
        batchDigest: preview.digest,
        evidence: `Board Approve brief action ${preview.requestId}`,
    });
    expect(s.records.read(id)).toMatchObject({ status: 'Ready', needsYou: null });
    expect((await s.commands.approveBrief(id, preview)).status).toBe(409);
});

test('board batch approval is atomic and a stale brief refuses every member', async () => {
    const s = await setup();
    const preview = await s.inspect(s.ids);
    const last = s.records.read(s.ids[1]!);

    s.records.setBody(last.workId, last.revision, 'brief', completeBrief('Changed after display.'));
    expect((await s.commands.approveBrief(s.ids[0]!, preview)).status).toBe(409);
    expect(s.ids.map((id) => s.records.gate(id).evidence)).toEqual([[], []]);

    const input = s.records.doubtPackage(last.workId);

    s.records.recordDoubt(last.workId, input.packageDigest, 'Doubt', 'Rechecked.', []);

    const renewed = await s.inspect(s.ids);

    expect((await s.commands.approveBrief(s.ids[0]!, renewed)).status).toBe(200);
    for (const id of s.ids)
        expect(s.records.gate(id).passing).toMatchObject({ approvedBy: 'Pedro', batchDigest: renewed.digest });
});

test('a changed build resumes Build after board approval and never requeues a second build', async () => {
    const s = await setup();
    const id = s.ids[0]!;
    const work = s.records.read(id);

    s.records.setBuildBranch(id, work.revision, 'build/same');

    const preview = await s.inspect();

    s.records.waitForUser(id, s.records.read(id).revision, 'Approve revised brief');
    expect((await s.commands.approveBrief(id, preview)).status).toBe(200);
    expect(s.records.read(id)).toMatchObject({ status: 'In progress', buildBranch: 'build/same', needsYou: null });
});

test('failed source refresh cannot record a gate', async () => {
    const s = await setup();
    const preview = await s.inspect();

    s.refresh.mockRejectedValueOnce(new Error('Tracker unavailable'));
    expect((await s.commands.approveBrief(s.ids[0]!, preview)).status).toBe(409);
    expect(s.records.gate(s.ids[0]!).evidence).toEqual([]);
});

test('S06 batch approval readies Queued children and automatically notifies their waiting owner', async () => {
    const s = await setup();
    let parent = s.records.create({
        title: 'Greeting exchange',
        repository: 'fake/app',
        kind: 'concept',
        status: 'Shaping',
    });

    parent = s.records.addThread(parent.workId, parent.revision, 'owner-thread', 'shape');
    s.records.waitForUser(parent.workId, parent.revision, 'Approve briefs in the board');
    for (const id of s.ids) {
        s.records.setParent(id, s.records.read(id).revision, parent.workId);
        s.records.update(id, s.records.read(id).revision, { status: 'Queued' });
    }
    for (const id of s.ids) {
        const input = s.records.doubtPackage(id);

        s.records.recordDoubt(id, input.packageDigest, 'Doubt', 'Group checked.', []);
    }

    const send = vi.fn<typeof sendThreadCommand>(async () => ({ outcome: 'accepted' as const, sequence: 1 }));
    const board = createBoardState({
        items: [...s.ids, parent.workId].map((id) => ({ id }) as Item),
        repos: [],
        firstRead: { settled: true },
    } as never);
    const commands = createBriefApproval({
        board,
        records: s.records,
        reread: vi.fn(),
        refresh: s.refresh,
        sync: s.sync,
        identity: () => 'Pedro',
        send,
    });
    const preview = await commands.inspectBrief(s.ids[0]!, { workIds: s.ids });
    const approval = (preview.body as { approval: { requestId: string; digest: string } }).approval;

    expect((await commands.approveBrief(s.ids[0]!, approval)).status).toBe(200);
    expect(s.ids.map((id) => s.records.read(id).status)).toEqual(['Ready', 'Ready']);
    expect(s.records.read(parent.workId)).toMatchObject({ status: 'Shaping', needsYou: null });
    expect(
        (await commands.requestBriefChanges(s.ids[0]!, { ...approval, note: 'Do not send this after approval.' }))
            .status,
    ).toBe(409);
    for (const id of s.ids) expect(s.records.briefChangeRequests(id)).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
        threadId: 'owner-thread',
        type: 'message.dispatch',
        text: expect.stringContaining('approved'),
    });
});

test('a recorded approval retries its same owner notification after an unconfirmed send and board restart', async () => {
    const s = await setup();
    const id = s.ids[0]!;

    s.records.addThread(id, s.records.read(id).revision, 'same-owner', 'shape');

    const board = createBoardState({
        items: s.ids.map((id) => ({ id }) as Item),
        repos: [],
        firstRead: { settled: true },
    } as never);
    const send = vi.fn<typeof sendThreadCommand>(async () => ({ outcome: 'unconfirmed', reason: 'Connection lost' }));
    const commands = createBriefApproval({
        board,
        records: s.records,
        reread: vi.fn(),
        refresh: s.refresh,
        sync: s.sync,
        identity: () => 'Pedro',
        send,
    });
    const inspected = await commands.inspectBrief(id, {});
    const preview = (inspected.body as { approval: { requestId: string; digest: string } }).approval;

    expect((await commands.approveBrief(id, preview)).status).toBe(200);
    expect(s.records.read(id).status).toBe('Ready');
    expect(s.records.pendingGateResumes()).toHaveLength(1);

    const firstCommand = send.mock.calls[0]![0];
    const dir = opened.at(-1)!.dir;
    const records = await openWorkRecords(join(dir, 'work.db'));

    opened.push({ dir, records });

    const retry = vi.fn<typeof sendThreadCommand>(async () => ({ outcome: 'accepted', sequence: 1 }));
    const restarted = createBriefApproval({
        board,
        records,
        reread: vi.fn(),
        refresh: s.refresh,
        sync: s.sync,
        send: retry,
    });

    await restarted.reconcileBriefApprovals();
    await restarted.reconcileBriefApprovals();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0]![0]).toMatchObject({ commandId: firstCommand.commandId, threadId: 'same-owner' });
    expect(records.pendingGateResumes()).toEqual([]);
    expect(records.gate(id).evidence).toHaveLength(1);
});

test('Request changes saves Pedro’s note for every displayed member, keeps gates and resumes the shaping owners', async () => {
    const s = await setup();
    const send = vi.fn<typeof import('../t3/thread-commands.ts').sendThreadCommand>(async () => ({
        outcome: 'accepted' as const,
        sequence: 1,
    }));
    const board = createBoardState({
        items: s.ids.map((id) => ({ id }) as Item),
        repos: [],
        firstRead: { settled: true },
    } as never);

    for (const id of s.ids) {
        const work = s.records.read(id);

        s.records.addThread(id, work.revision, `shape-${id}`, 'shape');
    }

    const commands = createBriefApproval({
        board,
        records: s.records,
        reread: vi.fn(),
        refresh: s.refresh,
        sync: s.sync,
        identity: () => 'Pedro',
        send,
    });
    const displayed = await commands.inspectBrief(s.ids[0]!, { workIds: s.ids });
    const approval = (displayed.body as { approval: { requestId: string; digest: string } }).approval;

    expect(
        (await commands.requestBriefChanges(s.ids[0]!, { ...approval, note: 'Name the failing test.', by: 'spoof' }))
            .status,
    ).toBe(200);
    for (const id of s.ids) {
        expect(s.records.read(id).status).toBe('Shaping');
        expect(recordItems(s.records, [], ['fake/app']).find((item) => item.id === id)).toMatchObject({
            status: 'Shaping',
            briefChangesRequested: true,
        });
        expect(recordItems(s.records, [], ['fake/app']).find((item) => item.id === id)?.briefApproval).toBeUndefined();
        expect(s.records.briefChangeRequests(id)[0]).toMatchObject({
            by: 'Pedro',
            note: 'Name the failing test.',
            delivery: { sent: true },
        });
    }
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
        type: 'message.dispatch',
        text: expect.stringContaining('Name the failing test.'),
    });
    expect((await commands.approveBrief(s.ids[0]!, approval)).status).toBe(409);
});

test('a failed change-request delivery keeps approval history and retries the same message after reopening records', async () => {
    const s = await setup();
    const id = s.ids[0]!;

    s.records.addThread(id, s.records.read(id).revision, 'shaping-owner', 'shape');

    const send = vi
        .fn<typeof import('../t3/thread-commands.ts').sendThreadCommand>()
        .mockResolvedValueOnce({ outcome: 'accepted', sequence: 1 })
        .mockResolvedValueOnce({ outcome: 'unconfirmed', reason: 'Connection lost' })
        .mockResolvedValue({ outcome: 'accepted', sequence: 1 });
    const board = createBoardState({ items: [{ id }], repos: [] } as never);
    const dependencies = {
        board,
        records: s.records,
        reread: vi.fn(),
        refresh: s.refresh,
        sync: s.sync,
        identity: () => 'Pedro',
        send,
    };
    const commands = createBriefApproval(dependencies);
    const shown = await commands.inspectBrief(id, {});
    const approval = (shown.body as { approval: { requestId: string; digest: string } }).approval;

    expect((await commands.approveBrief(id, approval)).status).toBe(200);

    const prior = s.records.gate(id);
    const next = await commands.inspectBrief(id, {});
    const display = (next.body as { approval: { requestId: string; digest: string } }).approval;

    expect(
        (await commands.requestBriefChanges(id, { ...display, note: 'Add the missing boundary assertion.' })).status,
    ).toBe(200);
    expect(s.records.gate(id)).toEqual(prior);
    expect(s.records.briefChangeRequests(id)[0]).toMatchObject({
        by: 'Pedro',
        at: expect.stringMatching(/^\d{4}-/),
        delivery: { sent: false, error: 'Connection lost' },
    });

    // A fresh board command instance has no in-memory inspection receipt, but can resume durable delivery.
    const reopened = createBriefApproval(dependencies);

    expect((await reopened.retryBriefChanges(id)).status).toBe(200);
    expect(send.mock.calls[2]?.[0]).toEqual(send.mock.calls[1]?.[0]);
    expect(s.records.briefChangeRequests(id)[0]?.delivery.sent).toBe(true);
    expect(s.records.read(id).status).toBe('Shaping');
    expect(recordItems(s.records, [], ['fake/app']).find((item) => item.id === id)).toMatchObject({
        status: 'Shaping',
        briefChangesRequested: true,
    });
    expect(recordItems(s.records, [], ['fake/app']).find((item) => item.id === id)?.briefApproval).toBeUndefined();
});

test('a stale batch change request or empty note writes no member', async () => {
    const s = await setup();
    const preview = await s.inspect(s.ids);
    const id = s.ids[0]!;
    const before = s.ids.map((member) => s.records.read(member));

    expect((await s.commands.requestBriefChanges(id, { ...preview, note: ' ' })).status).toBe(409);
    expect(s.ids.map((member) => s.records.read(member))).toEqual(before);

    const last = s.records.read(s.ids[1]!);

    s.records.setBody(last.workId, last.revision, 'brief', completeBrief('Changed before request.'));
    expect((await s.commands.requestBriefChanges(id, { ...preview, note: 'Rework this.' })).status).toBe(409);
    for (const member of s.ids) expect(s.records.briefChangeRequests(member)).toEqual([]);
});

test.each(['accepted', 'unconfirmed'] as const)(
    'Request changes on a linked batch sends one owner note without an approval notification (%s)',
    async (outcome) => {
        const s = await setup();
        let parent = s.records.create({
            title: 'Linked work',
            repository: 'fake/app',
            kind: 'build',
            status: 'Shaping',
        });

        parent = s.records.addThread(parent.workId, parent.revision, 'linked-owner', 'shape');
        parent = s.records.addThread(parent.workId, parent.revision, 'linked-builder', 'build');
        s.records.waitForUser(parent.workId, parent.revision, 'Approve briefs in the board');

        const ids = s.ids.map(
            (_, index) =>
                s.records.createPart({
                    parentId: parent.workId,
                    parentRevision: s.records.read(parent.workId).revision,
                    title: `Linked part ${index}`,
                    repository: 'fake/app',
                    kind: 'build',
                    body: completeBrief(`Complete linked brief ${index}.`),
                    blockerIds: [],
                }).workId,
        );

        s.ids.splice(0, s.ids.length, ...ids);
        for (const id of s.ids) {
            const input = s.records.doubtPackage(id);

            s.records.recordDoubt(id, input.packageDigest, 'Doubt', 'Linked batch reviewed.', []);
        }
        expect(() => s.records.displayGate(parent.workId)).toThrow('linked parent has no delivery gate');

        const board = createBoardState({
            items: [...s.ids, parent.workId].map((id) => ({ id }) as Item),
            repos: [],
        } as never);
        const send = vi
            .fn<typeof sendThreadCommand>()
            .mockResolvedValueOnce(
                outcome === 'accepted'
                    ? { outcome: 'accepted', sequence: 1 }
                    : { outcome: 'unconfirmed', reason: 'Connection lost' },
            )
            .mockResolvedValue({ outcome: 'accepted', sequence: 1 });
        const commands = createBriefApproval({
            board,
            records: s.records,
            reread: vi.fn(),
            refresh: s.refresh,
            sync: s.sync,
            send,
            identity: () => 'Pedro',
        });
        const displayed = await commands.inspectBrief(s.ids[0]!, { workIds: s.ids });
        const approval = (displayed.body as { approval: { requestId: string; digest: string } }).approval;

        expect(
            (await commands.requestBriefChanges(s.ids[0]!, { ...approval, note: 'Name the boundary tests.' })).status,
        ).toBe(200);
        await commands.reconcileBriefApprovals();
        expect(send).toHaveBeenCalledTimes(1);
        expect(send.mock.calls[0]?.[0]).toMatchObject({
            threadId: 'linked-owner',
            text: expect.stringContaining('Name the boundary tests.'),
        });
        expect(send.mock.calls[0]?.[0]).toMatchObject({ text: expect.stringContaining(s.ids[0]!) });
        expect(send.mock.calls[0]?.[0]).toMatchObject({ text: expect.stringContaining(s.ids[1]!) });
        expect(s.records.pendingGateResumes()).toEqual([]);

        if (outcome === 'unconfirmed') {
            for (const id of s.ids) expect(s.records.briefChangeRequests(id)[0]?.delivery.sent).toBe(false);

            const restarted = createBriefApproval({
                board,
                records: s.records,
                reread: vi.fn(),
                refresh: s.refresh,
                sync: s.sync,
                send,
            });

            expect((await restarted.retryBriefChanges(s.ids[1]!)).status).toBe(200);
            expect(send.mock.calls[1]?.[0]).toEqual(send.mock.calls[0]?.[0]);
        }

        for (const id of s.ids) {
            expect(s.records.gate(id).evidence).toEqual([]);
            expect(s.records.briefChangeRequests(id)[0]?.delivery.sent).toBe(true);
            expect(s.records.read(id).status).toBe('Shaping');
        }
        expect(s.records.read(parent.workId)).toMatchObject({ status: 'Shaping', needsYou: null });
        expect((await commands.approveBrief(s.ids[0]!, approval)).status).toBe(409);
        expect(send).toHaveBeenCalledTimes(outcome === 'accepted' ? 1 : 2);
    },
);

test('S03 single amended build approval durably resumes its build owner even with a newer shaping thread', async () => {
    const s = await setup();
    const id = s.ids[0]!;

    s.records.setBuildBranch(id, s.records.read(id).revision, 'build/same');
    s.records.addThread(id, s.records.read(id).revision, 'build-owner', 'build');
    s.records.addThread(id, s.records.read(id).revision, 'newer-shaping', 'shape');
    s.records.waitForUser(id, s.records.read(id).revision, 'Approve amended brief');

    const board = createBoardState({ items: [{ id }], repos: [] } as never);
    const send = vi.fn<typeof sendThreadCommand>(async () => ({ outcome: 'unconfirmed', reason: 'Connection lost' }));
    const deps = {
        board,
        records: s.records,
        reread: vi.fn(),
        refresh: s.refresh,
        sync: s.sync,
        identity: () => 'Pedro',
        send,
    };
    const commands = createBriefApproval(deps);
    const inspected = await commands.inspectBrief(id, {});
    const approval = (inspected.body as { approval: { requestId: string; digest: string } }).approval;

    expect((await commands.approveBrief(id, approval)).status).toBe(200);
    expect(s.records.read(id)).toMatchObject({ status: 'In progress', needsYou: null });
    expect(send.mock.calls[0]![0]).toMatchObject({ threadId: 'build-owner' });
    expect(s.records.pendingGateResumes()).toHaveLength(1);

    const records = await openWorkRecords(join(opened.at(-1)!.dir, 'work.db'));

    opened.push({ dir: opened.at(-1)!.dir, records });

    const retry = vi.fn<typeof sendThreadCommand>(async () => ({ outcome: 'accepted', sequence: 1 }));
    const restarted = createBriefApproval({ ...deps, records, send: retry });

    await restarted.reconcileBriefApprovals();
    await restarted.reconcileBriefApprovals();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(retry.mock.calls[0]![0]).toEqual(send.mock.calls[0]![0]);
    expect(records.pendingGateResumes()).toEqual([]);
});
