import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { completeBrief } from '../test/complete-brief.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 's05-linked-'));
    const records = await openWorkRecords(workRecordsPath(dir));

    opened.push({ records, dir });

    return { records, dir };
}

test('S05 R2-002: shared Dependency evidence preserves B/C approvals, while a changed prerequisite contract holds B', async () => {
    const { records } = await fixture();
    const g = records.create({ title: 'Linked exchange', repository: 'fake/a', kind: 'build' });
    const b = records.createPart({
        title: 'B reader',
        repository: 'fake/b',
        parentId: g.workId,
        parentRevision: g.revision,
        kind: 'build',
        body: completeBrief('Read v1.\nContracts: `greeting-v1`'),
        blockerIds: [],
    });
    const c = records.createPart({
        title: 'C view',
        repository: 'fake/c',
        parentId: g.workId,
        parentRevision: records.read(g.workId).revision,
        kind: 'build',
        body: completeBrief('Show v1.\nContracts: `greeting-v1`'),
        blockerIds: [b.workId],
    });
    const e = records.addDependency(g.workId, {
        need: 'Hosting',
        owner: 'Hosting team',
        contract: 'Allow reader origin.',
        evidence: 'Initial rollout note.',
    });

    records.addDependencyBlock(e.dependencyId, e.revision, b.workId);
    for (const r of [b, c]) {
        const input = records.doubtPackage(r.workId);

        records.recordDoubt(r.workId, input.packageDigest, 'Doubt', 'Contracts agree.');
    }

    const manifest = records.gateBatch([b.workId, c.workId]);

    records.recordGateBatch(manifest, manifest.digest, 'Pedro', 'Board fixture.');

    const briefDigests = [b, c].map((r) => records.gate(r.workId).briefDigest);

    records.updateDependency(e.dependencyId, records.dependency(e.dependencyId).revision, {
        evidence: 'Provider confirmed rollout.',
    });
    expect([b, c].map((r) => records.gate(r.workId).briefDigest)).toEqual(briefDigests);
    expect([b, c].map((r) => records.gate(r.workId).current)).toEqual([true, true]);
    records.updateDependency(e.dependencyId, records.dependency(e.dependencyId).revision, {
        contract: 'Reader must authenticate.',
    });
    expect(records.gate(b.workId).current).toBe(false);
    expect(records.gate(c.workId).current).toBe(true);
});
