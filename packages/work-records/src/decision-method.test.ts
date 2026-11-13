import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: { dir: string; records?: WorkRecords }[] = [];

afterEach(() => {
    for (const entry of opened.splice(0)) {
        entry.records?.close();
        rmSync(entry.dir, { recursive: true, force: true });
    }
});

const folder = () => {
    const entry: (typeof opened)[number] = { dir: mkdtempSync(join(tmpdir(), 'decision-method-')) };

    opened.push(entry);

    return entry;
};

test('a saved method survives rewrites, reopening and explicit clearing, with revision and kind validation', async () => {
    const entry = folder();
    const path = join(entry.dir, 'work-records.db');
    let records = (entry.records = await openWorkRecords(path));
    let task = records.create({ title: 'Activate release', repository: 'example/release', kind: 'decision' });

    task = records.setBody(task.workId, task.revision, 'decision', 'Method: task\nStage the release.');
    expect(task.decisionMethod).toBe('task');
    task = records.setBody(task.workId, task.revision, 'decision', 'Staged artifacts awaiting approval.');
    records.close();
    records = entry.records = await openWorkRecords(path);
    expect(records.read(task.workId).decisionMethod).toBe('task');
    expect(() => records.update(task.workId, task.revision - 1, { decisionMethod: 'research' })).toThrow(/revision/);
    expect(() => records.update(task.workId, task.revision, { decisionMethod: 'invalid' as 'task' })).toThrow(
        /decision method/,
    );
    task = records.update(task.workId, task.revision, { decisionMethod: 'research' });
    task = records.setBody(task.workId, task.revision, 'decision', 'Method: task\nChanged prose.');
    expect(task.decisionMethod).toBe('research');
    task = records.update(task.workId, task.revision, { decisionMethod: null });
    task = records.setBody(task.workId, task.revision, 'decision', 'Method: task\nMore prose.');
    expect(task.decisionMethod).toBeNull();

    const build = records.create({ title: 'Build', repository: 'example/release', kind: 'build' });

    expect(() => records.update(build.workId, build.revision, { decisionMethod: 'task' })).toThrow(
        'Only a decision holds a method.',
    );
});

test('migration imports existing method headers once without changing bodies or revisions', async () => {
    const entry = folder();
    const path = join(entry.dir, 'work-records.db');
    const legacy = await openDatabase(path, { migrations: MIGRATIONS.slice(0, -1) });
    const body = 'Method: Task\nStage the release.';

    legacy.db
        .prepare(
            "INSERT INTO work_records (work_id,title,repository,kind,status,revision,created_at,updated_at) VALUES ('task','Release','example/release','decision','Shaping',4,'now','now')",
        )
        .run();
    legacy.db
        .prepare(
            "INSERT INTO bodies (work_id,body,markdown,written,has_content,has_passing_gate) VALUES ('task','decision',?,1,1,0)",
        )
        .run(body);
    legacy.close();

    const records = (entry.records = await openWorkRecords(path));

    expect(records.read('task').decisionMethod).toBe('task');
    expect(records.read('task').revision).toBe(4);
    expect(records.body('task', 'decision')).toBe(body);
    records.setBody('task', 4, 'decision', 'Waiting for exact manifest approval.');
    expect(records.read('task').decisionMethod).toBe('task');
});
