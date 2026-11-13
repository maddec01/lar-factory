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
test('retitles with revision protection, durable history and latest-title-only outbox', async () => {
    dir = mkdtempSync(join(tmpdir(), 'retitle-'));

    const path = join(dir, 'work.db');

    records = await openWorkRecords(path);

    const record = records.create({
        title: 'Old scope',
        repository: 'example/repo',
        kind: 'build',
        ticket: 'example/repo#1',
        context: 'Original context',
    });

    expect(() => records.retitle(record.workId, 1, '  ')).toThrow('nonempty');

    expect(() => records.retitle(record.workId, 1, 'Two\nlines')).toThrow('one line');

    const changed = records.retitle(record.workId, 1, 'New scope');

    expect(changed).toMatchObject({ title: 'New scope', revision: 2, ticket: record.ticket });
    expect(() => records.retitle(record.workId, 1, 'Stale')).toThrow('read it again');
    expect(records.titleHistory(record.workId)).toHaveLength(1);
    records.retitle(record.workId, 2, 'Final scope');
    records.close();
    records = await openWorkRecords(path);
    expect(records.titleHistory(record.workId).map((entry) => [entry.previous, entry.title, entry.pending])).toEqual([
        ['Old scope', 'New scope', false],
        ['New scope', 'Final scope', true],
    ]);
    expect(records.initialContext(record.workId)).toBe('Original context');
    expect(records.retitle(record.workId, 3, 'Final scope').revision).toBe(3);
    expect(records.titleProjections()).toHaveLength(1);
});
