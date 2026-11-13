import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { orderWork, workOrder, workOrderReport, type OrderedWork } from './work-order.ts';
import { openWorkRecords } from './work-records.ts';

const row = (workId: string, at?: string, blockers: string[] = []): OrderedWork => ({
    workId,
    title: workId,
    repository: 'example/repo',
    kind: 'build',
    status: 'Ready',
    revision: 1,
    brief: 'Build it',
    gate: {
        briefDigest: 'digest',
        current: Boolean(at),
        passing: at
            ? {
                  workId,
                  sourceRevision: 1,
                  gateId: workId,
                  briefDigest: 'digest',
                  approvedBy: 'Pedro',
                  evidence: 'yes',
                  recordedAt: at,
              }
            : null,
        evidence: [],
    },
    blockers: blockers.map((id) => ({ workId: id, title: id, complete: false })),
    waits: [],
    complete: false,
    setAside: false,
});

it('orders the available graph by gate age then ID, independently of queue or input order', () => {
    const rows = [
        row('dependent', '2000', ['a']),
        row('z', '2001'),
        row('a', '2002'),
        row('b', '2002'),
        row('ungated'),
    ];
    const expected = ['z', 'a', 'dependent', 'b', 'ungated'];

    expect(orderWork(rows).map((entry) => entry.workId)).toEqual(expected);
    expect(orderWork(rows.toReversed()).map((entry) => entry.workId)).toEqual(expected);
    expect(() => orderWork([row('a', undefined, ['b']), row('b', undefined, ['a'])])).toThrow('cycle');
});

it('reports saved briefs, cross-repository blockers, decisions and every hold without changing records', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'work-order-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    try {
        const group = records.create({ title: 'Concept', kind: 'concept', repository: 'example/a' });
        const decision = records.createPart({
            parentId: group.workId,
            parentRevision: records.read(group.workId).revision,
            title: 'Choose',
            kind: 'decision',
            repository: 'example/a',
            body: 'Choose one',
            blockerIds: [],
        });
        const build = records.createPart({
            parentId: group.workId,
            parentRevision: records.read(group.workId).revision,
            title: 'Implement',
            kind: 'build',
            repository: 'example/b',
            body: 'Build exactly this',
            blockerIds: [decision.workId],
        });
        const before = records.changes();
        const rows = await records.snapshot(async () => workOrder(records, group.workId));

        expect(rows.map((entry) => entry.workId)).toEqual([decision.workId, build.workId]);
        expect(rows[1]).toMatchObject({
            brief: 'Build exactly this',
            status: 'Queued',
            repository: 'example/b',
            gate: { passing: null },
            blockers: [{ workId: decision.workId, complete: false }],
        });
        expect(rows[1]!.waits).toEqual(
            expect.arrayContaining([
                expect.stringContaining('Choose'),
                expect.stringContaining('approved gate'),
                'Status is Queued.',
            ]),
        );
        expect(workOrderReport(rows)).toContain('Brief: saved; gate: not approved');
        expect(records.changes()).toBe(before);
        records.update(build.workId, records.read(build.workId).revision, { status: 'Done' });
        expect(workOrder(records, group.workId).find((entry) => entry.workId === build.workId)?.waits).toContain(
            'It has no recorded PR.',
        );
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
