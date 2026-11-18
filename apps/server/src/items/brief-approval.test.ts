import type { Item } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { completeBrief } from '../../test/complete-brief.ts';
import { legacyApprovalNotice } from '../../test/legacy-notice.ts';
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

        records.recordDoubt(work.workId, input.packageDigest, 'Doubt', 'Clean.');

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

    legacyApprovalNotice(s.records, id, 'Approve this brief');
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

    s.records.recordDoubt(last.workId, input.packageDigest, 'Doubt', 'Rechecked.');

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

    legacyApprovalNotice(s.records, id, 'Approve revised brief');
    expect((await s.commands.approveBrief(id, preview)).status).toBe(200);
    expect(s.records.read(id)).toMatchObject({ status: 'In progress', buildBranch: 'build/same', needsYou: null });
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
    const reread = vi.fn();
    const restarted = createBriefApproval({
        board,
        records,
        reread,
        refresh: s.refresh,
        sync: s.sync,
        send: retry,
    });

    await restarted.reconcileBriefApprovals();
    expect(reread).toHaveBeenCalledTimes(1);
    // Each local refresh reconciles; one that writes nothing leaves the shown records as they are.
    await restarted.reconcileBriefApprovals();
    expect(reread).toHaveBeenCalledTimes(1);
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

test('a changed brief request includes the exact previously approved consumer text and can be approved', async () => {
    const s = await setup();
    const id = s.ids[0]!;
    const first = await s.inspect();

    expect((await s.commands.approveBrief(id, first)).status).toBe(200);

    const before = s.records.body(id, 'brief')!;
    const after = before.replace('Complete brief 0.', 'Use the compatible producer output.');

    s.records.setBody(id, s.records.read(id).revision, 'brief', after);
    s.records.recordDoubt(id, s.records.doubtPackage(id).packageDigest, 'Doubt', 'Changed consumer reviewed.');
    expect(s.records.gate(id).current).toBe(false);

    const changed = await s.inspect();

    expect(changed.briefs[0]).toMatchObject({ brief: after, previousBrief: before });
    expect((await s.commands.approveBrief(id, changed)).status).toBe(200);
    expect(s.records.gate(id).current).toBe(true);
});
