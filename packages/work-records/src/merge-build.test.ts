import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { openWorkRecords, type WorkRecords } from './work-records.ts';

let records: WorkRecords;
let dir: string;

afterEach(() => {
    records?.close();

    if (dir) rmSync(dir, { recursive: true, force: true });
});

async function fixture() {
    dir = mkdtempSync(join(tmpdir(), 'merge-build-'));
    records = await openWorkRecords(join(dir, 'work.db'));

    const create = (title: string) =>
        records.create({ title, kind: 'build', repository: 'example/repo', context: `Context ${title}` });
    const source = create('Absorbed');
    const target = create('Survivor');
    const a = create('First prerequisite');
    const b = create('Second prerequisite');
    const dependent = create('Downstream');

    records.setBody(source.workId, 1, 'brief', '## Acceptance\n- Absorbed acceptance.');
    records.setBody(target.workId, 1, 'brief', '## Acceptance\n- Survivor acceptance.');
    records.attachTicket(source.workId, 2, 'example/repo#1');
    records.attachTicket(target.workId, 2, 'example/repo#2');

    const add = (id: string, blocker: string) => records.addBlocker(id, records.read(id).revision, blocker);

    add(source.workId, a.workId);
    add(target.workId, b.workId);
    add(dependent.workId, source.workId);

    const input = () => ({
        into: target.workId,
        revisions: Object.fromEntries(records.list({}).map((r) => [r.workId, r.revision])),
    });

    return { source, target, a, b, dependent, add, input, revision: () => records.read(source.workId).revision };
}

test('absorbs all acceptance and context, redirects incoming edges and unions prerequisites without a PR', async () => {
    const f = await fixture();

    records.recordGate(f.target.workId, records.read(f.target.workId).revision, {
        briefDigest: records.gate(f.target.workId).briefDigest!,
        approvedBy: 'user',
        evidence: 'Approved',
    });
    records.update(f.target.workId, records.read(f.target.workId).revision, { status: 'Ready' });

    const result = records.mergeBuild(f.source.workId, f.revision(), f.input());

    expect(result.source).toMatchObject({
        supersededBy: f.target.workId,
        setAside: true,
        ticket: 'example/repo#1',
        pullRequest: null,
    });
    expect(result.target).toMatchObject({ ticket: 'example/repo#2', status: 'Shaping', pullRequest: null });
    expect(
        records
            .blockers(f.target.workId)
            .map((r) => r.workId)
            .sort(),
    ).toEqual([f.a.workId, f.b.workId].sort());
    expect(records.blockers(f.dependent.workId).map((r) => r.workId)).toEqual([f.target.workId]);

    const brief = records.body(f.target.workId, 'brief');

    for (const text of ['Absorbed acceptance', 'Survivor acceptance', 'Context Absorbed', 'example/repo#1'])
        expect(brief).toContain(text);
    expect(records.body(f.source.workId, 'brief')).toContain('Absorbed acceptance');
    expect(records.gate(f.target.workId).passing).toBeNull();
    expect(records.completion(f.source.workId).complete).toBe(false);
    expect(() => records.restore(f.source.workId, result.source.revision)).toThrow('absorbed');
});
test('rejects stale affected records and active inputs without changing anything', async () => {
    const f = await fixture();
    const input = f.input();

    input.revisions[f.dependent.workId] = 1;

    const before = records.list({});

    expect(() => records.mergeBuild(f.source.workId, f.revision(), input)).toThrow('read it again');
    expect(records.list({})).toEqual(before);
    records.setBuildPhase(f.target.workId, records.read(f.target.workId).revision, 'implement');
    expect(() => records.mergeBuild(f.source.workId, f.revision(), f.input())).toThrow('Only proposed');
    expect(records.read(f.source.workId).setAside).toBe(false);
});
test('cycle introduced by contracting builds rolls back every edge and body', async () => {
    const f = await fixture();

    f.add(f.a.workId, f.target.workId);

    const before = records.list({});
    const body = records.body(f.target.workId, 'brief');

    expect(() => records.mergeBuild(f.source.workId, f.revision(), f.input())).toThrow('cycle');
    expect(records.list({})).toEqual(before);
    expect(records.body(f.target.workId, 'brief')).toBe(body);
    expect(records.blockers(f.dependent.workId).map((r) => r.workId)).toEqual([f.source.workId]);
});
test('unions held external Dependencies with revision protection', async () => {
    const f = await fixture();
    const dependency = records.addDependency(f.source.workId, { need: 'External contract', owner: 'Other team' });

    records.addDependencyBlock(dependency.dependencyId, dependency.revision, f.source.workId);

    const before = records.list({});

    expect(() => records.mergeBuild(f.source.workId, f.revision(), f.input())).toThrow('dependencyRevisions');
    expect(records.list({})).toEqual(before);
    records.mergeBuild(f.source.workId, f.revision(), {
        ...f.input(),
        dependencyRevisions: { [dependency.dependencyId]: records.dependency(dependency.dependencyId).revision },
    });
    expect(records.unmetDependencies(f.target.workId).map((d) => d.dependencyId)).toEqual([dependency.dependencyId]);
});
