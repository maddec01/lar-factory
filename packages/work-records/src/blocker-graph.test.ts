import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vite-plus/test';

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
    const { a, b, c, d, add } = await fixture();

    add(a, d);
    add(b, c);
    records.close();

    const legacy = new DatabaseSync(join(dir, 'work.db'));

    legacy
        .prepare('INSERT INTO blockers(work_id, blocker_id) VALUES (?, ?), (?, ?)')
        .run(a.workId, c.workId, a.workId, b.workId);
    legacy.exec(`PRAGMA user_version = ${MIGRATIONS.length - 1}`);
    legacy.close();
    records = await openWorkRecords(join(dir, 'work.db'));

    expect(new Set(records.blockers(a.workId).map((r) => r.workId))).toEqual(new Set([b.workId, d.workId]));
    expect(records.blockers(b.workId).map((r) => r.workId)).toEqual([c.workId]);

    const lone = records.create({ title: 'Lone', repository: 'test/repo', kind: 'build' })!;

    expect(records.setAside(lone.workId, lone.revision).setAside).toBeTruthy();
    expect(() => add(d, c)).not.toThrow();
});
