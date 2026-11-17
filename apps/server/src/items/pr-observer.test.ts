import type { Item, LinkedPr } from '@lar-factory/shared';
import { openWorkRecords, type PullRequestState, type WorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { prUrl } from '../config/pr-host.ts';
import { createPrObserver } from './pr-observer.ts';

const repo = 'owner/repo';
const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture(repository = repo) {
    const dir = mkdtempSync(join(tmpdir(), 'pr-observer-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    opened.push({ records, dir });

    const created = records.create({
        repository,
        title: 'Work without an issue',
        kind: 'build',
        status: 'Review',
    });
    const record = records.setPullRequest(created.workId, created.revision, `${repository}#4`);
    const read = vi.fn<(repo: string, number: number) => Promise<PullRequestState | LinkedPr>>(async () => 'open');
    const changed = vi.fn();
    const hidden = new Set<string>();
    const options = { repositories: () => [repository], hidden: () => hidden, waits: () => false, read, changed };

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

test('a confirmed merge stays Done through late handback and review phases', async () => {
    const { records, record, options } = await fixture();

    records.observe(record.workId, record.revision, { of: 'pr', state: 'merged' });
    records.update(record.workId, records.read(record.workId).revision, { status: 'Ready to merge' });
    records.setBuildPhase(record.workId, records.read(record.workId).revision, 'review');
    expect(records.read(record.workId)).toMatchObject({ status: 'Done', finishedAt: expect.any(String) });

    const observer = createPrObserver(records, options);

    await observer.poll(0);
    expect(records.read(record.workId)).toMatchObject({ status: 'Done', finishedAt: expect.any(String) });
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

test('a merge confirmation refreshes the saved ticket before publishing Done', async () => {
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
    await observer.poll(0);
    expect(readTicket).toHaveBeenCalledWith(repo, 12);
    expect(records.read(record.workId)).toMatchObject({ status: 'Done', needsYouCauses: [] });
});

test('a failed Azure check read keeps the last known check counts, marked stale', async () => {
    const azure = 'org/project/repo';
    const { records, record, options, read } = await fixture(azure);
    const url = prUrl(azure, 4);
    const checks = { passed: 3, failed: 1, running: 0, total: 4, since: null };
    const pr: LinkedPr = {
        number: 4,
        url,
        state: 'open',
        isDraft: false,
        sourceRevision: 'abc123',
        mergeState: 'blocked',
        checks,
        checkProgress: { state: 'current', coverage: 'all' },
    };
    const observer = createPrObserver(records, options);
    const shown = () =>
        observer.project([{ id: record.workId, recorded: false, linkedPrs: [{ ...pr, checks: null }] } as Item])[0]!
            .linkedPrs[0]!;

    read.mockResolvedValueOnce(pr);
    await observer.poll(0);
    // The Azure read finds the PR but not its checks, as `readObservedPr` reports a failed check read.
    read.mockResolvedValueOnce({
        ...pr,
        checks: null,
        mergeState: 'checking',
        checkProgress: { state: 'unavailable' },
    });
    await observer.poll(300_000);
    expect(shown()).toMatchObject({ checks, checkProgress: { state: 'stale' } });
    read.mockRejectedValueOnce(new Error('Azure PR progress unavailable.'));
    await observer.poll(600_000);
    expect(shown()).toMatchObject({ checks, checkProgress: { state: 'stale' } });
});

test('a failed read with no known check counts says checks are unavailable, never stale with no checks', async () => {
    const { records, record, options, read } = await fixture();

    read.mockRejectedValueOnce(new Error('Provider unavailable'));
    await createPrObserver(records, options).poll(0);

    // A restarted board keeps the failed observation but none of the counts the earlier observer read.
    const [shown] = createPrObserver(records, options).project([
        {
            id: record.workId,
            linkedPrs: [{ number: 4, url: prUrl(repo, 4), state: 'open', isDraft: false, checks: null }],
        } as unknown as Item,
    ])[0]!.linkedPrs;

    expect(shown).toMatchObject({ checks: null, checkProgress: { state: 'unavailable' } });
});
