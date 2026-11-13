import { deskItems, retroWaits, type BoardData, type Item } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { createRetro } from './retro.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

const suggestions = ['Improve help', 'Document a retry'].map((title) => ({
    title,
    description: `${title} for future builds.`,
    repository: 'owner/repo',
    kind: 'improvement' as const,
}));

async function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'retro-server-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    opened.push({ records, dir });

    let record = records.create({ title: 'Build', repository: 'owner/repo', kind: 'bug', status: 'Ready to merge' });
    const id = record.workId;

    record = records.setPullRequest(id, record.revision, 'owner/repo#1');
    record = records.addThread(id, record.revision, 'build-thread', 'build');
    records.setBuildPhase(id, record.revision, 'checks');

    const board = createBoardState({
        items: [],
        repos: [{ repo: 'owner/repo', setup: { createIssuesFromRetro: false } }],
    } as unknown as BoardData);
    const at = () => records.read(id).revision;
    const reread = () => {
        const work = records.read(id);

        board.update({
            items: [
                {
                    id,
                    status: work.status,
                    buildPhase: work.buildPhase,
                    retro: records.retro(id),
                    updatedAt: work.updatedAt,
                    threads: [],
                } as unknown as Item,
            ],
        });
    };
    const send = vi.fn<NonNullable<Parameters<typeof createRetro>[0]['send']>>(async () => ({
        outcome: 'accepted' as const,
        sequence: 1,
    }));
    const commands = createRetro({ board, records, reread, send, identity: () => 'Pedro' });

    reread();

    const merge = () => {
        records.observe(id, at(), { of: 'pr', state: 'merged' });
        records.update(id, at(), { status: 'Done' });
        reread();
    };
    const propose = (list = suggestions) => {
        records.proposeRetro(id, at(), list);
        reread();
    };

    return { board, records, id, at, reread, send, commands, merge, propose };
}

test('only confirmed merge and Done dispatch the same build retro, exactly once across refreshes', async () => {
    const s = await setup();

    await s.commands.reconcileRetros();
    expect(s.send).not.toHaveBeenCalled();
    s.records.update(s.id, s.at(), { status: 'Done' });
    s.reread();
    await s.commands.reconcileRetros();
    expect(s.send).not.toHaveBeenCalled();
    s.merge();
    await s.commands.reconcileRetros();
    await s.commands.reconcileRetros();
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.send.mock.calls[0]?.[0]).toMatchObject({
        threadId: 'build-thread',
        type: 'message.dispatch',
        text: expect.stringContaining('confirmed merged'),
    });
    expect(s.records.read(s.id).status).toBe('Done');
    expect(deskItems(s.board.snapshot(), false)).toEqual([]);
});

test('one desk wait lists all suggestions, creates only picks, and replay makes no duplicate', async () => {
    const s = await setup();

    s.merge();
    await s.commands.reconcileRetros();
    s.propose();
    expect(deskItems(s.board.snapshot(), false)).toHaveLength(1);
    expect(s.board.find(s.id)?.retro?.suggestions).toHaveLength(2);

    const result = await s.commands.chooseRetro(s.id, { revision: s.at(), selected: [1] });

    expect(result.status).toBe(200);
    expect(s.records.list({ status: 'List' }).map((r) => r.title)).toEqual(['Document a retry']);
    expect(s.records.retro(s.id)?.choice).toMatchObject({ selected: [1], by: 'Pedro' });
    expect(deskItems(s.board.snapshot(), false)).toEqual([]);
    await s.commands.retryRetro(s.id);
    expect(s.records.list({ status: 'List' })).toHaveLength(1);
    expect(s.records.read(s.id).status).toBe('Done');
});

test('No follow-ups is recorded; an empty proposal never reaches the desk', async () => {
    const s = await setup();

    s.merge();
    await s.commands.reconcileRetros();
    s.propose();
    await s.commands.chooseRetro(s.id, { revision: s.at(), selected: [] });
    expect(s.records.retro(s.id)?.choice?.selected).toEqual([]);
    expect(s.records.list({ status: 'List' })).toEqual([]);
    expect(deskItems(s.board.snapshot(), false)).toEqual([]);

    const t = await setup();

    t.merge();
    await t.commands.reconcileRetros();
    t.propose([]);
    expect(deskItems(t.board.snapshot(), false)).toEqual([]);
});

test('lost T3 dispatch remains a desk retry using the same command receipt', async () => {
    const s = await setup();

    s.merge();

    const send = vi
        .fn()
        .mockResolvedValueOnce({ outcome: 'unconfirmed', reason: 'Connection lost' })
        .mockResolvedValue({ outcome: 'accepted', sequence: 1 });
    const commands = createRetro({ ...s, send });

    await commands.reconcileRetros();
    expect(retroWaits(s.records.retro(s.id))).toBe(true);
    await commands.retryRetro(s.id);
    expect(send.mock.calls[0]?.[0].commandId).toBe(send.mock.calls[1]?.[0].commandId);
    expect(retroWaits(s.records.retro(s.id))).toBe(false);
});

test('a failed ticket keeps its local record and desk retry, with no duplicate capture on retry', async () => {
    const s = await setup();

    s.merge();
    await s.commands.reconcileRetros();
    s.propose();
    s.board.update({
        repos: [{ repo: 'owner/repo', setup: { createIssuesFromRetro: true } }] as unknown as BoardData['repos'],
    });

    const provider = {
        create: vi.fn(async () => {
            throw new Error('Provider unavailable');
        }),
    } as unknown as NonNullable<NonNullable<Parameters<typeof createRetro>[0]['capture']>['provider']>;
    const commands = createRetro({ ...s, capture: { provider } });

    await commands.chooseRetro(s.id, { revision: s.at(), selected: [0] });

    const receipt = s.records.retro(s.id)!.captures[0]!;

    expect(receipt.workId).toBeTruthy();
    expect(receipt.complete).toBe(false);
    expect(receipt.error).toBeTruthy();
    expect(deskItems(s.board.snapshot(), false)).toHaveLength(1);
    await commands.retryRetro(s.id);
    expect(s.records.retro(s.id)!.captures[0]?.workId).toBe(receipt.workId);
    expect(s.records.list({ status: 'List' })).toHaveLength(1);
    expect(s.records.read(s.id).status).toBe('Done');
});

test('a completed empty proposal supersedes an unconfirmed dispatch and never reaches the desk', async () => {
    const s = await setup();

    s.merge();

    const commands = createRetro({
        ...s,
        send: async () => {
            s.records.proposeRetro(s.id, s.at(), []);

            return { outcome: 'unconfirmed', reason: 'Response lost after the build ran.' };
        },
    });

    await commands.reconcileRetros();
    expect(s.records.retro(s.id)?.delivery).toMatchObject({ sent: true, error: null });
    expect(deskItems(s.board.snapshot(), false)).toEqual([]);
});

test('a missing build thread does not start a repeated refresh loop after merge', async () => {
    const s = await setup();

    s.merge();
    s.records.markShapingThreadDeleted('build-thread');

    const reread = vi.fn(s.reread);
    const commands = createRetro({ ...s, reread });

    await commands.reconcileRetros();
    expect(s.send).not.toHaveBeenCalled();
    expect(reread).not.toHaveBeenCalled();
});
