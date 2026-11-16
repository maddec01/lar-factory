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
