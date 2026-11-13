import type { RepositorySetup } from '@lar-factory/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';

import { syncSpecs } from './spec-sync.ts';
import type { StructureProvider, StructureTicket } from './tracker-sync.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

let records: WorkRecords;
let dir: string;

afterEach(() => {
    records?.close();

    if (dir) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
    dir = mkdtempSync(join(tmpdir(), 'title-sync-'));
    records = await openWorkRecords(join(dir, 'work.db'));

    const record = records.create({
        title: 'Old',
        kind: 'build',
        repository: 'example/repo',
        ticket: 'example/repo#1',
    });

    records.retitle(record.workId, 1, 'New');

    const remote: StructureTicket = {
        repository: record.repository,
        number: 1,
        title: 'Old',
        body: 'Keep authored text',
        version: '1',
    };
    const replaceTitle = vi.fn(async (ticket: StructureTicket, title: string) => ({ ...ticket, title }));
    const provider = { readSpec: async () => remote, replaceTitle } as unknown as StructureProvider;
    const setup = {
        repo: record.repository,
        writeRefinedSpec: true,
        access: { 'edit-ticket': 'allowed' },
    } as unknown as RepositorySetup;

    return { record, provider, setup, replaceTitle };
}

test('projects titles without publishing ungated text', async () => {
    const f = await fixture();

    records.setBody(f.record.workId, 2, 'brief', 'Ungated changes');
    await syncSpecs(records, { provider: f.provider, setups: [f.setup] });
    expect(f.replaceTitle).toHaveBeenCalledWith(expect.objectContaining({ body: 'Keep authored text' }), 'New');
    expect(records.titleProjections()).toEqual([]);
    expect(records.body(f.record.workId, 'brief')).toBe('Ungated changes');
});
test('refused access retains a visible failure and retries the exact title', async () => {
    const f = await fixture();

    await syncSpecs(records, {
        provider: f.provider,
        setups: [{ ...f.setup, access: { 'edit-ticket': 'refused' } as RepositorySetup['access'] }],
    });
    expect(f.replaceTitle).not.toHaveBeenCalled();
    expect(records.specState(f.record.workId).error).toContain('Title:');
    expect(records.titleProjections()[0]?.error).toBeTruthy();
    await syncSpecs(records, { provider: f.provider, setups: [f.setup], workId: f.record.workId });
    expect(f.replaceTitle).toHaveBeenCalledOnce();
    expect(records.specState(f.record.workId).error).toBeNull();
});
test('disabled tracker setting suppresses the title write', async () => {
    const f = await fixture();

    await syncSpecs(records, { provider: f.provider, setups: [{ ...f.setup, writeRefinedSpec: false }] });
    expect(f.replaceTitle).not.toHaveBeenCalled();
    expect(records.titleProjections()).toEqual([]);
});
test('an older in-flight write cannot acknowledge a newer title', async () => {
    const f = await fixture();

    f.replaceTitle.mockImplementationOnce(async (ticket, title) => {
        records.retitle(f.record.workId, 2, 'Latest');

        return { ...ticket, title };
    });
    await syncSpecs(records, { provider: f.provider, setups: [f.setup] });
    expect(records.titleProjections().map((entry) => entry.title)).toEqual(['Latest']);
});
