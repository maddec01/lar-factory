import type { Item, LinkedPr } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import type { MergeProvider } from '../config/pr-merge.ts';
import { createPrMerge } from './pr-merge.ts';
import { createPrObserver } from './pr-observer.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function setup(repo = 'owner/repo') {
    const dir = mkdtempSync(join(tmpdir(), 'pr-merge-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    opened.push({ records, dir });

    let record = records.create({ title: 'Build', repository: repo, kind: 'bug', status: 'Ready to merge' });

    record = records.setPullRequest(record.workId, record.revision, `${repo}#8`);

    const pr: LinkedPr = {
        number: 8,
        url:
            repo.split('/').length === 2
                ? `https://github.com/${repo}/pull/8`
                : `https://dev.azure.com/o/p/_git/r/pullrequest/8`,
        sourceRevision: 'abc',
        state: 'open',
        isDraft: false,
        checks: null,
        mergeState: 'can merge',
    };
    const item = {
        id: record.workId,
        repo,
        status: 'Ready to merge',
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
    const read = vi.fn<MergeProvider['read']>(async () => ({
        pr: { ...pr },
        methods: ['squash'] as const,
        blockers: [] as string[],
    }));
    const merge = vi.fn(async () => {
        pr.state = 'merged';
    });
    const commands = createPrMerge({ board, records, reread: vi.fn(), provider: () => ({ read, merge }) });
    const inspect = async () =>
        (await commands.inspectMerge(item.id)).body as {
            confirmation: { token: string; sourceRevision: string; url: string; methods: string[] };
        };

    return { ...commands, inspect, records, item, board, pr, read, merge };
}

test('confirmation binds the recorded delivery PR and method; only provider confirmation completes work', async () => {
    const s = await setup();
    const { confirmation } = await s.inspect();

    expect(confirmation).toMatchObject({ sourceRevision: 'abc', url: s.pr.url, methods: ['squash'] });
    expect(s.merge).not.toHaveBeenCalled();
    expect((await s.mergePr(s.item.id, { token: confirmation.token, method: 'squash' })).status).toBe(200);
    expect(s.merge).toHaveBeenCalledWith('owner/repo', 8, 'abc', 'squash');
    expect(s.records.read(s.item.id).status).toBe('Done');
});

test('a poll started before an in-board merge cannot overwrite confirmed completion', async () => {
    const s = await setup();
    const open = { ...s.pr };
    let release!: (pr: LinkedPr) => void;
    const observer = createPrObserver(s.records, {
        repositories: () => ['owner/repo'],
        hidden: () => new Set(),
        waits: () => false,
        changed: vi.fn(),
        read: () =>
            new Promise<LinkedPr>((resolve) => {
                release = resolve;
            }),
    });
    const poll = observer.poll(0);
    const { confirmation } = await s.inspect();

    expect((await s.mergePr(s.item.id, { token: confirmation.token, method: 'squash' })).status).toBe(200);
    release(open);
    await poll;
    expect(s.records.observations(s.item.id)).toContainEqual(expect.objectContaining({ of: 'pr', state: 'merged' }));
    expect(observer.project([s.item])[0]?.linkedPrs[0]?.state).toBe('merged');
});

test("refuses another item's valid confirmation without a provider mutation", async () => {
    const s = await setup();
    let other = s.records.create({ title: 'Other', repository: 'owner/repo', kind: 'bug', status: 'Ready to merge' });

    other = s.records.setPullRequest(other.workId, other.revision, 'owner/repo#9');

    const otherItem = {
        ...s.item,
        id: other.workId,
        linkedPrs: [{ ...s.pr, number: 9, url: s.pr.url.replace(/8$/, '9') }],
    };

    s.board.update({ items: [s.item, otherItem] });

    const { confirmation } = await s.inspect();

    expect((await s.mergePr(otherItem.id, { token: confirmation.token, method: 'squash' })).body).toMatchObject({
        error: 'Inspect and confirm this delivery PR again.',
    });
    expect(s.merge).not.toHaveBeenCalled();
    expect(s.read).toHaveBeenCalledTimes(1);
});

test('refuses wrong identity, changed head and a method revoked after confirmation', async () => {
    const s = await setup();
    const { confirmation } = await s.inspect();

    expect((await s.mergePr(s.item.id, { token: 'other', method: 'squash' })).status).toBe(409);
    s.pr.sourceRevision = 'new-head';
    expect((await s.mergePr(s.item.id, { token: confirmation.token, method: 'squash' })).body).toMatchObject({
        error: expect.stringContaining('revision changed'),
    });
    expect(s.merge).not.toHaveBeenCalled();

    const next = await s.inspect();

    s.read.mockImplementation(async () => ({ pr: { ...s.pr }, methods: [], blockers: [] }));
    expect((await s.mergePr(s.item.id, { token: next.confirmation.token, method: 'squash' })).body).toMatchObject({
        error: expect.stringContaining('no longer permitted'),
    });
    expect(s.merge).not.toHaveBeenCalled();
    s.records.setPullRequest(s.item.id, s.records.read(s.item.id).revision, 'owner/repo#99');
    expect((await s.inspectMerge(s.item.id)).status).toBe(409);
});

test('shares a pending guard and rereads an uncertain result before another attempt', async () => {
    const s = await setup();
    const { confirmation } = await s.inspect();
    let release!: () => void;

    s.merge.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
            release = resolve;
        });
        throw new Error('Response lost');
    });

    const first = s.mergePr(s.item.id, { token: confirmation.token, method: 'squash' });

    await vi.waitFor(() => expect(s.merge).toHaveBeenCalledTimes(1));
    expect((await s.mergePr(s.item.id, { token: confirmation.token, method: 'squash' })).status).toBe(409);
    expect((await s.inspectMerge(s.item.id)).status).toBe(409);
    s.read.mockRejectedValue(new Error('Provider unavailable'));
    release();
    expect((await first).status).toBe(409);
    expect(s.records.read(s.item.id).status).toBe('Ready to merge');
    expect((await s.inspectMerge(s.item.id)).status).toBe(409);
    s.read.mockImplementation(async () => ({
        pr: { ...s.pr, state: 'merged' },
        methods: ['squash'],
        blockers: [],
    }));
    expect((await s.inspectMerge(s.item.id)).body).toMatchObject({ merged: true });
    expect(s.records.read(s.item.id).status).toBe('Done');
    expect(s.merge).toHaveBeenCalledTimes(1);
});

test.each([{ status: 'Verify' }, { threads: [{ id: 'build', purpose: 'build', currentRunning: true }] }])(
    'refuses stage and activity gate %j without provider calls',
    async (patch) => {
        const s = await setup();

        Object.assign(s.item, patch);
        s.board.update({ items: [s.item] });
        expect((await s.inspectMerge(s.item.id)).status).toBe(409);
        expect(s.read).not.toHaveBeenCalled();
    },
);

test('refuses a PR whose checks failed', async () => {
    const s = await setup();

    s.pr.checks = { passed: 1, failed: 1, running: 0, total: 2, since: null };
    expect((await s.inspectMerge(s.item.id)).status).toBe(409);
    expect(s.merge).not.toHaveBeenCalled();
});

test('Azure read-only sessions allow eligibility reads but refuse writes before the provider mutation', async () => {
    const s = await setup('o/p/r');

    vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '1');

    const { confirmation } = await s.inspect();

    expect(confirmation).toBeDefined();
    expect((await s.mergePr(s.item.id, { token: confirmation.token, method: 'squash' })).body).toMatchObject({
        error: expect.stringContaining('read-only'),
    });
    expect(s.merge).not.toHaveBeenCalled();
});

test('fallback merge uses the freshly read repository default, ignoring a legacy client method', async () => {
    const s = await setup();

    s.read.mockImplementation(async () => ({
        pr: { ...s.pr },
        methods: ['merge', 'squash'],
        defaultMethod: 'squash',
        blockers: [],
    }));

    const { confirmation } = await s.inspect();

    expect((await s.mergePr(s.item.id, { token: confirmation.token, method: 'merge' })).status).toBe(200);
    expect(s.merge).toHaveBeenCalledWith('owner/repo', 8, 'abc', 'squash');
});
