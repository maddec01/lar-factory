import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import type { DependentResolution } from './set-aside.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

let records: WorkRecords;
let dir: string;

afterEach(() => {
    records?.close();

    if (dir) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
    dir = mkdtempSync(join(tmpdir(), 'set-aside-'));
    records = await openWorkRecords(join(dir, 'work.db'));

    const create = (title: string) => records.create({ title, kind: 'build', repository: 'example/repo' });
    const source = create('Retire');
    const replacement = create('Replacement');
    const dependents = ['Replace', 'Remove', 'Hold'].map(create);

    for (const dependent of dependents) records.addBlocker(dependent.workId, 1, source.workId);

    const plan: DependentResolution[] = dependents.map((record, index) => ({
        workId: record.workId,
        revision: 2,
        reason: 'Settled scope',
        ...(index === 0
            ? { action: 'replace', blockerId: replacement.workId, blockerRevision: 1 }
            : { action: index === 1 ? 'remove' : 'hold' }),
    })) as DependentResolution[];

    return { source, replacement, dependents, plan, revision: records.read(source.workId).revision };
}

test('resolves every dependent in one commit, retaining tickets, bodies and hold evidence', async () => {
    const f = await fixture();

    records.attachTicket(f.source.workId, f.revision, 'example/repo#1');

    const result = records.setAside(f.source.workId, f.revision + 1, f.plan);

    expect(result).toMatchObject({ setAside: true, ticket: 'example/repo#1', status: 'List', pullRequest: null });
    expect(records.blockers(f.dependents[0]!.workId).map((r) => r.workId)).toEqual([f.replacement.workId]);
    expect(records.blockers(f.dependents[1]!.workId)).toEqual([]);
    expect(records.waitingOn(f.dependents[2]!.workId)).toEqual([
        { workId: f.source.workId, reasons: [expect.stringContaining('set aside')] },
    ]);
    expect(records.read(f.dependents[2]!.workId).needsYou).toContain('Settled scope');
    expect(records.setAsideHistory(f.source.workId)[0]?.dependents).toEqual(f.plan);
    expect(f.dependents.map((r) => records.read(r.workId).revision)).toEqual([3, 3, 3]);
});
test('omitted dependent and stale last dependent abort every write', async () => {
    const f = await fixture();
    const before = records.list({});

    expect(() => records.setAside(f.source.workId, f.revision, f.plan.slice(0, 2))).toThrow('every dependent');
    expect(() =>
        records.setAside(
            f.source.workId,
            f.revision,
            f.plan.map((r, i) => ({ ...r, revision: i === 2 ? 1 : r.revision })),
        ),
    ).toThrow('read it again');
    expect(records.list({})).toEqual(before);
    expect(records.setAsideHistory(f.source.workId)).toEqual([]);
});
test('a cycle discovered after edge rewrites rolls back the retirement and all edges', async () => {
    const f = await fixture();

    records.addBlocker(f.replacement.workId, 1, f.dependents[0]!.workId);

    const plan = f.plan.map((r) =>
        r.action === 'replace' ? { ...r, revision: records.read(r.workId).revision, blockerRevision: 2 } : r,
    );
    const before = records.list({});

    expect(() => records.setAside(f.source.workId, f.revision, plan)).toThrow('cycle');
    expect(records.list({})).toEqual(before);
    for (const dependent of f.dependents)
        expect(records.blockers(dependent.workId).map((r) => r.workId)).toEqual([f.source.workId]);
    expect(records.setAsideHistory(f.source.workId)).toEqual([]);
});
