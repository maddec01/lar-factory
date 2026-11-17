import { deskItems, deskWait, type BoardData, type Item } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { sendThreadCommand } from '../t3/thread-commands.ts';
import { createItemCommands, type ItemCommandsDeps } from './item-commands.ts';
import { createRetro } from './retro.ts';

vi.mock('../t3/thread-commands.ts', async (original) => ({
    ...(await original<typeof import('../t3/thread-commands.ts')>()),
    sendThreadCommand: vi.fn(),
}));

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
                    linkedPrs: [],
                } as unknown as Item,
            ],
        });
    };
    const commands = createRetro({ board, records, reread, identity: () => 'Pedro' });

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

    return { board, records, id, at, reread, commands, merge, propose };
}

test('before merge, one desk wait lists all suggestions, creates only picks, and replay makes no duplicate', async () => {
    const s = await setup();

    s.propose();
    expect(deskItems(s.board.snapshot(), false)).toHaveLength(1);
    expect(deskWait(s.board.find(s.id)!).label).toBe('Choose follow-ups');
    expect(s.board.find(s.id)?.retro?.suggestions).toHaveLength(2);

    const result = await s.commands.chooseRetro(s.id, { revision: s.at(), selected: [1] });

    expect(result.status).toBe(200);
    expect(s.records.list({ status: 'List' }).map((r) => r.title)).toEqual(['Document a retry']);
    expect(s.records.retro(s.id)?.choice).toMatchObject({ selected: [1], by: 'Pedro' });
    expect(deskWait(s.board.find(s.id)!).label).not.toBe('Choose follow-ups');
    expect((await s.commands.chooseRetro(s.id, { revision: s.at(), selected: [1] })).status).toBe(409);
    expect(s.records.list({ status: 'List' })).toHaveLength(1);
    expect(s.records.read(s.id).status).toBe('Ready to merge');
});

test('a failed follow-up is named in the reply, keeps its local record and no longer waits', async () => {
    const s = await setup();

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
    const result = await commands.chooseRetro(s.id, { revision: s.at(), selected: [0] });

    expect(result.status).toBe(409);
    expect((result.body as { error: string }).error).toMatch(/Improve help/);
    expect(s.records.list({ status: 'List' }).map((r) => r.title)).toEqual(['Improve help']);
    expect(deskWait(s.board.find(s.id)!).label).not.toBe('Choose follow-ups');
    expect(s.records.read(s.id).status).toBe('Ready to merge');
});

test('the board never sends a Retro message into the build thread after its delivery PR merges', async () => {
    const s = await setup();
    const send = vi.mocked(sendThreadCommand);
    const commands = createItemCommands({
        board: s.board,
        records: s.records,
        reread: s.reread,
        items: {} as ItemCommandsDeps['items'],
        archive: () => [],
        offerModelChoices: () => [],
        factoryContext: null,
    });

    s.merge();
    await commands.reconcileStarts(s.board.snapshot().items);
    await commands.reconcileStarts(s.board.snapshot().items);
    expect(send).not.toHaveBeenCalled();
    expect(s.records.retro(s.id)).toBeNull();
    expect(s.records.read(s.id).buildPhase).toBe('checks');
});
