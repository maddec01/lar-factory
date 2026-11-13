import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
import { openWorkRecords } from './work-records.ts';

test('upgrades an incorporated legacy answer without inventing its source revision', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'answer-migration-'));
    const path = join(dir, 'work.db');

    try {
        const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, -1) });

        for (const [id, kind, parent] of [
            ['g', 'concept', null],
            ['d', 'decision', 'g'],
        ] as const)
            old.db
                .prepare(
                    "INSERT INTO work_records(work_id,title,repository,kind,status,parent_id,revision,created_at,updated_at) VALUES (?,?,'example/repo',?,'Shaping',?,5,'2026-01-01','2026-01-01')",
                )
                .run(id, id, kind, parent);
        for (const [id, body, text, written] of [
            ['d', 'answer', 'Legacy contract', 1],
            ['d', 'domain-drafts', 'none', 2],
            ['g', 'map', 'Incorporated', 3],
        ] as const)
            old.db
                .prepare(
                    'INSERT INTO bodies(work_id,body,markdown,written,has_content,has_passing_gate) VALUES (?,?,?,?,1,0)',
                )
                .run(id, body, text, written);
        old.close();

        const records = await openWorkRecords(path);

        try {
            expect(records.decisionAnswer('d').current).toMatchObject({
                revision: 1,
                text: 'Legacy contract',
                sourceRevision: null,
            });
            expect(records.completion('d').complete).toBe(true);
            expect(records.read('d').revision).toBe(5);
        } finally {
            records.close();
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
