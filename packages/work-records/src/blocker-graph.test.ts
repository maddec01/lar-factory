import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { openWorkRecords, type WorkRecords } from './work-records.ts';

let records: WorkRecords;
let dir: string;

afterEach(() => {
    records?.close();

    if (dir) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
    dir = mkdtempSync(join(tmpdir(), 'blocker-graph-'));
    records = await openWorkRecords(join(dir, 'work.db'));

    const [a, b, c, d] = (['A', 'B', 'C', 'D'] as const).map((title) =>
        records.create({ title, repository: 'test/repo', kind: 'build' }),
    );
    const add = (work: NonNullable<typeof a>, blocker: NonNullable<typeof a>) =>
        records.addBlocker(work.workId, records.read(work.workId).revision, blocker.workId);

    return { a: a!, b: b!, c: c!, d: d!, add };
}

it('names an implying path and rolls back all records; diamond edges remain necessary', async () => {
    const { a, b, c, d, add } = await fixture();

    add(a, b);
    add(b, d);
    add(a, c);
    add(c, d);

    const before = records.list({});

    expect(() => add(a, d)).toThrow(`${a.workId} → ${b.workId} → ${d.workId}`);
    expect(records.list({})).toEqual(before);
    records.removeBlocker(b.workId, records.read(b.workId).revision, d.workId);
    expect(records.blockers(c.workId).map((r) => r.workId)).toEqual([d.workId]);
});
it('rejects an amendment that makes an existing edge redundant', async () => {
    const { a, b, c, add } = await fixture();

    add(a, c);
    add(b, c);
    expect(() => add(a, b)).toThrow('already implied');
    expect(records.blockers(a.workId).map((r) => r.workId)).toEqual([c.workId]);
});
it('rolls back imported and new-part batches with redundant prerequisites', async () => {
    const { a, b, c, add } = await fixture();

    add(b, c);
    expect(() =>
        records.restoreImported(a.workId, 1, { body: 'brief', markdown: 'Scope', blockerIds: [b.workId, c.workId] }),
    ).toThrow('already implied');
    expect(records.body(a.workId, 'brief')).toBeNull();

    const parent = records.create({ title: 'Concept', repository: 'test/repo', kind: 'concept' });
    const before = records.list({});

    expect(() =>
        records.createPart({
            parentId: parent.workId,
            parentRevision: 1,
            title: 'Part',
            repository: 'test/repo',
            kind: 'build',
            body: 'Scope',
            blockerIds: [b.workId, c.workId],
        }),
    ).toThrow('already implied');
    expect(records.list({})).toEqual(before);
});

it('rejects redundant edges from Dependency replacement without losing the external hold', async () => {
    const { a, b, c, add } = await fixture();
    const parent = records.create({ title: 'Destination', repository: 'test/repo', kind: 'concept' });

    for (const record of [a, b, c]) records.setParent(record.workId, 1, parent.workId);
    add(a, b);
    add(b, c);

    const dependency = records.addDependency(parent.workId, { need: 'Contract', owner: 'Other team' });
    const held = records.addDependencyBlock(dependency.dependencyId, dependency.revision, a.workId);
    const before = records.list({});

    expect(() => records.replaceDependencyWithBuild(held.dependencyId, held.revision, c.workId)).toThrow(
        'already implied',
    );
    expect(records.list({})).toEqual(before);
    expect(records.dependency(held.dependencyId)).toEqual(held);
});

it('rolls back structural recovery of a redundant graph before retaining imported identities', async () => {
    const { a, b, c, add } = await fixture();
    const parent = records.create({ title: 'Destination', repository: 'test/repo', kind: 'concept' });

    for (const record of [a, b, c]) records.setParent(record.workId, 1, parent.workId);
    add(a, b);
    add(b, c);

    const snapshot = records.trackerSnapshot(parent.workId);

    snapshot.nodes.find((node) => node.key === a.workId)!.blockers.push(c.workId);

    const fresh = await openWorkRecords(join(dir, 'fresh.db'));

    try {
        expect(() => fresh.trackerRestore(snapshot, 'a'.repeat(64))).toThrow('already implied');
        expect(fresh.list({})).toEqual([]);
    } finally {
        fresh.close();
    }
});
