import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { reduceBlockers } from './blocker-graph.ts';
import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
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

it('drops redundant blockers recorded before the rule so later writes succeed', async () => {
    dir = mkdtempSync(join(tmpdir(), 'blocker-graph-'));

    const path = join(dir, 'work.db');
    const legacy = await openDatabase(path, {
        migrations: MIGRATIONS.slice(0, MIGRATIONS.lastIndexOf(reduceBlockers)),
    });

    for (const id of ['a', 'b', 'c', 'd'])
        legacy.db
            .prepare(
                "INSERT INTO work_records(work_id,title,repository,kind,status,revision,created_at,updated_at) VALUES (?,?,'test/repo','build','List',1,'now','now')",
            )
            .run(id, id);
    legacy.db.exec("INSERT INTO blockers(work_id,blocker_id) VALUES ('a','d'),('b','c'),('a','c'),('a','b')");
    legacy.close();
    records = await openWorkRecords(path);

    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => records.read(id));
    const add = (work: NonNullable<typeof a>, blocker: NonNullable<typeof a>) =>
        records.addBlocker(work.workId, records.read(work.workId).revision, blocker.workId);

    expect(records.read('a').deliveryKind).toBeNull();

    expect(new Set(records.blockers(a!.workId).map((r) => r.workId))).toEqual(new Set([b!.workId, d!.workId]));
    expect(records.blockers(b!.workId).map((r) => r.workId)).toEqual([c!.workId]);

    const lone = records.create({ title: 'Lone', repository: 'test/repo', kind: 'build' })!;

    expect(records.setAside(lone.workId, lone.revision).setAside).toBeTruthy();
    expect(() => add(d!, c!)).not.toThrow();
});
