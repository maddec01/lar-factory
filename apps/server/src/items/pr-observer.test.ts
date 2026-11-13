import type { Item, LinkedPr } from '@lar-factory/shared';
import { openWorkRecords, type PullRequestState, type WorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { createPrObserver } from './pr-observer.ts';

const repo = 'owner/repo';
const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 'pr-observer-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    opened.push({ records, dir });

    const created = records.create({
        repository: repo,
        title: 'Work without an issue',
        kind: 'build',
        status: 'Review',
    });
    const record = records.setPullRequest(created.workId, created.revision, `${repo}#4`);
    const read = vi.fn<(repo: string, number: number) => Promise<PullRequestState | LinkedPr>>(async () => 'open');
    const changed = vi.fn();
    const hidden = new Set<string>();
    const options = { repositories: () => [repo], hidden: () => hidden, waits: () => false, read, changed };

    return { records, record, read, changed, hidden, options };
}

test('an issue-free build follows its PR within fifteen seconds and stops reading once merged', async () => {
    const { records, record, options, read } = await fixture();
    const observer = createPrObserver(records, options);

    await observer.poll(0);
    await observer.poll(14_999);
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValueOnce('merged');
    await observer.poll(15_000);
    expect(records.read(record.workId).status).toBe('Done');
    await observer.poll(30_000);
    expect(read).toHaveBeenCalledTimes(2);
});

test('a newly read linked PR finishes its record without a provider call', async () => {
    const { records, record, options, read } = await fixture();
    const observer = createPrObserver(records, options);

    await observer.known([{ linkedPrs: [{ url: `https://github.com/${repo}/pull/4`, state: 'merged' }] } as Item], 0);
    expect(records.read(record.workId).status).toBe('Done');
    expect(read).not.toHaveBeenCalled();
});

test('hidden work and repositories waiting on access are not polled', async () => {
    const { records, record, options, read, hidden } = await fixture();
    const observer = createPrObserver(records, options);

    hidden.add(record.workId);
    await observer.poll(0);
    hidden.clear();
    options.waits = () => true;
    await observer.poll(15_000);
    expect(read).not.toHaveBeenCalled();
});

test('a failed conditional read keeps the last state and waits before retrying', async () => {
    const { records, record, options, read } = await fixture();
    const observer = createPrObserver(records, options);

    await observer.poll(0);
    read.mockRejectedValueOnce(new Error('Provider unavailable'));
    await observer.poll(15_000);
    expect(records.read(record.workId).status).toBe('Review');
    expect(records.observations(record.workId)).toMatchObject([
        { of: 'pr', state: 'open', failure: 'Provider unavailable' },
    ]);
    await observer.poll(16_000);
    expect(read).toHaveBeenCalledTimes(2);
});

test('publishes progress for a recorded PR absent from ticket reads and retains stale counts after failures', async () => {
    const { records, record, options, read } = await fixture();
    const observer = createPrObserver(records, options);
    const pr: LinkedPr = {
        number: 4,
        url: `https://github.com/${repo}/pull/4`,
        state: 'open',
        isDraft: false,
        sourceRevision: 'head',
        mergeState: 'blocked',
        checks: { passed: 2, running: 1, failed: 0, total: 3, since: null },
        checkProgress: { state: 'current', coverage: 'all' },
    };
    const items = [{ id: record.workId, linkedPrs: [{ ...pr, pipelineUnread: true, checks: null }] } as Item];

    read.mockResolvedValue(pr);
    await observer.poll(0);
    expect(observer.project(items)[0]?.linkedPrs[0]).toMatchObject({
        checks: { total: 3 },
        checkProgress: { state: 'current' },
    });
    expect(observer.project(items)[0]?.linkedPrs[0]?.pipelineUnread).toBeUndefined();
    read.mockRejectedValueOnce(new Error('offline'));
    await observer.poll(15_000);
    expect(observer.project(items)[0]?.linkedPrs[0]).toMatchObject({
        checks: { passed: 2 },
        checkProgress: { state: 'stale' },
    });
    read.mockResolvedValueOnce({ ...pr, sourceRevision: 'new', checks: null, checkProgress: { state: 'unavailable' } });
    await observer.poll(30_000);
    expect(observer.project(items)[0]?.linkedPrs[0]).toMatchObject({
        sourceRevision: 'new',
        checks: null,
        checkProgress: { state: 'unavailable' },
    });
});

test('a state-only ticket recovery does not freshen failed check evidence or hide observer updates behind an old ticket revision', async () => {
    const { records, record, options, read } = await fixture();
    const pr: LinkedPr = {
        number: 4,
        url: `https://github.com/${repo}/pull/4`,
        state: 'open',
        isDraft: false,
        sourceRevision: 'old',
        mergeState: 'can merge',
        checks: { passed: 1, failed: 0, running: 0, total: 1, since: null },
        checkProgress: { state: 'current' },
    };
    const observer = createPrObserver(records, options);

    await observer.known([{ linkedPrs: [pr] } as Item], 0);
    read.mockResolvedValueOnce({
        ...pr,
        sourceRevision: 'new',
        checks: { passed: 2, failed: 0, running: 0, total: 2, since: null },
    });
    await observer.poll(300_000);

    const projected = [{ id: record.workId, linkedPrs: [pr] } as Item];

    expect(observer.project(projected)[0]?.linkedPrs[0]).toMatchObject({ sourceRevision: 'new', checks: { total: 2 } });
    read.mockRejectedValueOnce(new Error('checks offline'));
    await observer.poll(600_000);
    await observer.known(
        [{ linkedPrs: [{ ...pr, sourceRevision: 'new', checkProgress: undefined }] } as Item],
        601_000,
    );
    expect(observer.project(projected)[0]?.linkedPrs[0]?.checkProgress?.state).toBe('stale');
});

test('a source read can finish the PR without the progress cache restoring its former open state', async () => {
    const { records, record, options, read } = await fixture();
    const pr: LinkedPr = {
        number: 4,
        url: `https://github.com/${repo}/pull/4`,
        sourceRevision: 'head',
        state: 'open',
        isDraft: false,
        mergeState: 'can merge',
        checks: { passed: 1, failed: 0, running: 0, total: 1, since: null },
        checkProgress: { state: 'current' },
    };
    const observer = createPrObserver(records, options);

    read.mockResolvedValue(pr);
    await observer.poll(0);

    const merged = { ...pr, state: 'merged' as const, checkProgress: undefined };

    await observer.known([{ linkedPrs: [merged] } as Item], 1000);
    expect(records.read(record.workId).status).toBe('Done');
    expect(observer.project([{ id: record.workId, linkedPrs: [merged] } as Item])[0]?.linkedPrs[0]?.state).toBe(
        'merged',
    );
});

test('idle progress uses the five-minute safety cadence and a new head restores prompt reads', async () => {
    const { records, record, options, read } = await fixture();
    const observer = createPrObserver(records, options);
    const pr: LinkedPr = {
        number: 4,
        url: `https://github.com/${repo}/pull/4`,
        sourceRevision: 'head',
        state: 'open',
        isDraft: false,
        mergeState: 'can merge',
        checks: { passed: 1, failed: 0, running: 0, total: 1, since: null },
        checkProgress: { state: 'current' },
    };

    read.mockResolvedValue(pr);
    await observer.poll(0);
    await observer.poll(15_000);
    await observer.poll(299_999);
    expect(read).toHaveBeenCalledTimes(1);
    await observer.poll(300_000);
    expect(read).toHaveBeenCalledTimes(2);
    await observer.known(
        [{ linkedPrs: [{ ...pr, sourceRevision: 'new', checkProgress: undefined }] } as Item],
        301_000,
    );
    read.mockResolvedValue({ ...pr, sourceRevision: 'new', checks: { ...pr.checks!, passed: 0, running: 1 } });
    await observer.poll(315_000);
    await observer.poll(330_000);
    expect(read).toHaveBeenCalledTimes(4);
    expect(observer.project([{ id: record.workId, linkedPrs: [pr] } as Item])[0]?.linkedPrs[0]).toMatchObject({
        sourceRevision: 'new',
        checks: { running: 1 },
    });
});

test('unchanged unavailable progress backs off while preserving its unknown state', async () => {
    const { records, record, options, read } = await fixture();
    const pr: LinkedPr = {
        number: 4,
        url: `https://github.com/${repo}/pull/4`,
        sourceRevision: 'head',
        state: 'open',
        isDraft: false,
        mergeState: 'checking',
        checks: null,
        checkProgress: { state: 'unavailable' },
    };
    const observer = createPrObserver(records, options);

    read.mockResolvedValue(pr);
    await observer.poll(0);
    await observer.poll(15_000);
    await observer.poll(30_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(observer.project([{ id: record.workId, linkedPrs: [pr] } as Item])[0]?.linkedPrs[0]).toMatchObject({
        checks: null,
        checkProgress: { state: 'unavailable' },
    });
    await observer.poll(315_000);
    expect(read).toHaveBeenCalledTimes(3);
});

test('a build without a ticket uses current board activity for prompt polling', async () => {
    const { records, record, options, read } = await fixture();
    const pr: LinkedPr = {
        number: 4,
        url: `https://github.com/${repo}/pull/4`,
        state: 'open',
        isDraft: false,
        sourceRevision: 'head',
        mergeState: 'can merge',
        checks: { passed: 1, running: 0, failed: 0, total: 1, since: null },
        checkProgress: { state: 'current' },
    };
    const boardItems = [{ id: record.workId, threads: [], slices: [] } as unknown as Item];
    const observer = createPrObserver(records, { ...options, currentItems: () => boardItems });

    expect(records.read(record.workId).ticket).toBeNull();
    read.mockResolvedValue(pr);
    await observer.known([], 0);
    await observer.poll(0);
    await observer.poll(15_000);
    expect(read).toHaveBeenCalledTimes(1);
    boardItems[0] = {
        ...boardItems[0]!,
        threads: [{ purpose: 'build', state: 'running', currentRunning: true }],
    } as Item;
    await observer.poll(30_000);
    expect(read).toHaveBeenCalledTimes(2);
});

test.each(['poll', 'known'] as const)(
    '%s merge confirmation refreshes the saved ticket before publishing Done',
    async (method) => {
        const { records, record, options, read, changed } = await fixture();

        records.attachTicket(record.workId, records.read(record.workId).revision, `${repo}#12`);
        records.observe(record.workId, records.read(record.workId).revision, { of: 'ticket', state: 'open' });
        read.mockResolvedValue('merged');

        const readTicket = vi.fn(async () => ({ state: 'closed' as const }));
        const observer = createPrObserver(records, { ...options, readTicket });

        changed.mockImplementation(() => {
            expect(records.observations(record.workId)).toContainEqual(
                expect.objectContaining({ of: 'ticket', state: 'closed' }),
            );
        });

        if (method === 'poll') await observer.poll(0);
        else
            await observer.known(
                [{ linkedPrs: [{ url: `https://github.com/${repo}/pull/4`, state: 'merged' }] } as Item],
                0,
            );

        expect(readTicket).toHaveBeenCalledWith(repo, 12);
        expect(records.read(record.workId)).toMatchObject({ status: 'Done', needsYouCauses: [] });
    },
);
