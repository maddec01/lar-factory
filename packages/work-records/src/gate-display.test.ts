import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { openWorkRecords } from './work-records.ts';

it('binds the displayed text and source revision to durable approval evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gate-display-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    try {
        let work = records.create({ title: 'Search', repository: 'fake/app', kind: 'build' });

        work = records.setBody(work.workId, work.revision, 'brief', 'Find saved searches.');

        const display = records.displayGate(work.workId);
        const approve = (copy = display, digest = display.approvalDigest) =>
            records.recordDisplayedGate(copy, digest, 'Pedro', 'Yes, response 12; Doubt clean.');

        expect(() => approve({ ...display, brief: 'Find shared searches.' })).toThrow(/displayed brief/);
        expect(() => approve(display, display.briefDigest)).toThrow(/approval digest/);
        expect(records.gate(work.workId).evidence).toEqual([]);
        records.update(work.workId, work.revision, { status: 'Shaping' });
        expect(() => approve()).toThrow(/revision/);

        const fresh = records.displayGate(work.workId);
        const evidence = approve(fresh, fresh.approvalDigest);

        expect(evidence).toMatchObject({ sourceRevision: fresh.sourceRevision, approvalDigest: fresh.approvalDigest });
        expect(records.gate(work.workId).passing).toMatchObject(evidence);
        work = records.read(work.workId);
        records.setBody(work.workId, work.revision, 'brief', 'Find shared searches.');
        expect(records.gate(work.workId).current).toBe(false);
        expect(() => approve(fresh, fresh.approvalDigest)).toThrow(/displayed brief/);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
